import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import {unlinkSync,chmodSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function publicAddress(ip){
 if(isIP(ip)===4){
  const [a,b,c]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
 }
 // Only ordinary global unicast IPv6; reject transition, mapped, special and documentation space.
 if(isIP(ip)!==6)return false;
 const parts=ip.toLowerCase().split(':'),first=parseInt(parts[0],16),second=parseInt(parts[1]||'0',16);
 return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002&&first!==0x3ffe&&!(first===0x3fff&&second<0x1000);
}
export function webhookUrl(value){
 if(typeof value!=='string'||value.length>2048||/[\s\u0000-\u001f\\]/.test(value))throw Error('INVALID_WEBHOOK_URL');
 let u;try{u=new URL(value);}catch{throw Error('INVALID_WEBHOOK_URL');}
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.hash||!host||host.endsWith('.')||!isIP(host)&&(!host.includes('.')||/\.(localhost|local|internal|test|invalid|onion)$/i.test(host))||isIP(host)&&!publicAddress(host))throw Error('INVALID_WEBHOOK_URL');
 return u;
}
export async function resolveWebhook(value,resolver=lookup){
 const u=webhookUrl(value),host=u.hostname.replace(/^\[|\]$/g,''),answers=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true,verbatim:true});
 if(!answers.length||answers.some(a=>!publicAddress(a.address)))throw Error('WEBHOOK_ADDRESS_DENIED');
 return {u,address:answers[0]};
}
export async function egressOperation(input,{resolver=lookup,request=https.request,timeout=5000}={}){
 let req,aborted=false;
 const work=async()=>{
  const {u,address}=await resolveWebhook(input.url,resolver);
  if(aborted)throw Error('WEBHOOK_TIMEOUT');
  if(input.op==='validate')return {ok:true};
  if(input.op!=='deliver'||typeof input.body!=='string'||Buffer.byteLength(input.body)>200000||!/^sha256=[a-f0-9]{64}$/.test(input.signature)||!/^\d{10,12}$/.test(input.timestamp)||typeof input.event_id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.event_id))throw Error('INVALID_EGRESS_REQUEST');
  return new Promise((resolve,reject)=>{
   // Pin the checked address to this TLS connection, preserving hostname/SNI and certificate verification.
   req=request(u,{method:'POST',agent:false,rejectUnauthorized:true,lookup:(_host,options,cb)=>options?.all?cb(null,[address]):cb(null,address.address,address.family),headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(input.body),'X-Bot-Event-Id':input.event_id,'X-Bot-Timestamp':input.timestamp,'X-Bot-Signature':input.signature}},res=>{
    const status=res.statusCode;let size=0;
    res.on('data',chunk=>{size+=chunk.length;if(size>8192){res.destroy();req.destroy();reject(Error('WEBHOOK_RESPONSE_TOO_LARGE'));}});
    res.on('end',()=>resolve({ok:status>=200&&status<300,status}));res.on('error',reject);
   });req.on('error',reject);req.end(input.body);
  });
 };
 let timer;
 try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{aborted=true;req?.destroy();reject(Error('WEBHOOK_TIMEOUT'));},timeout);})]);}
 finally{clearTimeout(timer);}
}
export function egressClient(socketPath){
 return input=>new Promise((resolve,reject)=>{
  const data=JSON.stringify(input);let size=0,result='';
  const req=http.request({socketPath,path:'/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{res.on('data',c=>{size+=c.length;if(size>8192)req.destroy(Error('EGRESS_RESPONSE_TOO_LARGE'));else result+=c;});res.on('end',()=>{try{const value=JSON.parse(result);if(!value.ok&&value.error)reject(Error(value.error));else resolve(value);}catch(e){reject(e);}});res.on('error',reject);});
  req.setTimeout(6500,()=>req.destroy(Error('EGRESS_TIMEOUT')));req.on('error',reject);req.end(data);
 });
}
export function createEgressServer(){
 let active=0;
 return http.createServer({requestTimeout:7000,headersTimeout:7000},async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/'||active>=8){res.writeHead(503);return res.end('{}');}
  active++;
  try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>256000)throw Error('EGRESS_REQUEST_TOO_LARGE');chunks.push(c);}const result=await egressOperation(JSON.parse(Buffer.concat(chunks).toString('utf8')));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
  catch{if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'WEBHOOK_VALIDATION_OR_DELIVERY_FAILED'}));}
  finally{active--;}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path=process.env.WEBHOOK_EGRESS_SOCKET||'/run/volna-webhook/egress.sock';
 try{unlinkSync(path);}catch(e){if(e.code!=='ENOENT')throw e;}
 createEgressServer().listen(path,()=>{chmodSync(path,0o660);console.log('Webhook egress ready');});
}
