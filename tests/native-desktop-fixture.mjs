// Local-only integration fixture. Never imported by production server code.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/index.mjs';
let counter=510000,loseMessage=false;const sms=[],origins=[],directory=mkdtempSync(join(tmpdir(),'volna-native-test-'));
process.env.TURN_HOST='127.0.0.1';process.env.TURN_SECRET='volna-native-local-test-only';
const app=createApp({database:':memory:',uploads:directory,origins,newsEnabled:false,phoneAuthOptions:{smsReady:true,codeGenerator:()=>String(++counter),sender:async value=>{sms.push(value);return{id:'fixture'};},logger:()=>{}},callLogOptions:{directory:join(directory,'calls')}});
const webRoot=resolve(fileURLToPath(new URL('../client/dist/',import.meta.url)));
const front=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){
  if(loseMessage&&req.method==='POST'&&/^\/api\/chats\/\d+\/messages$/.test(req.url)){
   loseMessage=false;const writeHead=res.writeHead,end=res.end;res.writeHead=function(status,...args){return writeHead.call(this,503,...args)};res.end=function(){return end.call(this,JSON.stringify({error:'Ответ потерян после сохранения сообщения'}))};
  }
  return app.server.emit('request',req,res);
 }
 try{const path=new URL(req.url,'http://local').pathname;const file=resolve(webRoot,'.'+decodeURIComponent(path));if(!file.startsWith(webRoot+sep))throw Error();const content=await readFile(file);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg','.json':'application/json'};res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>front.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+front.address().port;origins.push(url);
async function call(path,data,token){const response=await fetch(url+'/api'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});if(!response.ok)throw Error(await response.text());return response.json();}
async function account(phone){const start=await call('/auth/sms/request',{phone});return call('/auth/sms/verify',{sms_session_id:start.sms_session_id,code:sms.at(-1).code});}
const a=await account('+79990000101'),b=await account('+79990000102');const c=await account('+79990000103');const mobiles=[a,b,c];for(const [person,name] of [[a,'Андрей'],[b,'Елена'],[c,'Андрей']])app.db.prepare('UPDATE users SET name=? WHERE id=?').run(name,person.user.id);const chat=await call('/chats',{user_id:b.user.id},a.token);const chatC=await call('/chats',{user_id:b.user.id},c.token);await call('/chats/'+chatC.id+'/messages',{text:'Привет из Волны 👋',client_id:'native-fixture-chat-c-0001'},b.token);
await call('/chats/'+chat.id+'/messages',{text:'Сообщение с телефона 👋',client_id:'native-fixture-message-0001'},b.token);
// A dedicated control server on loopback exposes only synthetic test data.
const control=http.createServer(async(req,res)=>{try{let data='';for await(const part of req)data+=part;const input=JSON.parse(data||'{}');let result;if(req.url==='/code'){const row=app.db.prepare('SELECT chat_id FROM login_code_channels WHERE owner=?').get(input.user_id);const messages=row?await call('/chats/'+row.chat_id+'/messages',undefined,mobiles.find(m=>m.user.id===input.user_id)?.token):[];const text=messages.findLast(m=>/Код входа в Волну: (\d{6})/.test(m.text))?.text||'';result={code:text.match(/Код входа в Волну: (\d{6})/)?.[1]||''};}else if(req.url==='/qr'){await call('/auth/qr/scan',{qr_text:input.qr_text},a.token);await call('/auth/qr/confirm',{qr_text:input.qr_text,approve:true},a.token);result={ok:true};}else if(req.url==='/message'){result=await call('/chats/'+chat.id+'/messages',{text:input.text,client_id:input.client_id},b.token);}else if(req.url==='/lose-message'){loseMessage=true;result={ok:true};}else if(req.url==='/message-count'){result=app.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE text=?').get(input.text);}else if(req.url==='/calls'){result=app.db.prepare('SELECT status,answered,ended FROM call_history ORDER BY created DESC').all();}else throw Error();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}catch{res.writeHead(500);res.end('{}');}});
await new Promise(r=>control.listen(0,'127.0.0.1',r));console.log(JSON.stringify({url,control:'http://127.0.0.1:'+control.address().port,phoneA:a.user.phone,phoneB:b.user.phone,idA:a.user.id,idB:b.user.id,phoneC:c.user.phone,idC:c.user.id,chatC:chatC.id,chat:chat.id}));
process.on('SIGTERM',()=>{control.close();front.close();app.close().finally(()=>{rmSync(directory,{recursive:true,force:true});process.exit();});});
