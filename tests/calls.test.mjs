import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
import {calls} from '../server/calls.mjs';
import {randomBytes,createHmac} from 'node:crypto';
const d=()=>randomBytes(16).toString('hex');
test('calls: chat authorization, device claims, lifecycle, busy and private signaling',async()=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 async function req(path,t,data){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};}
 try{
  const users=[];for(const username of ['alice','boris','carol'])users.push((await req('/register','',{username,password:'password-long-enough'})).data);
  const [a,b,c]=users,da=d(),db=d(),dc=d();const chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id;
  assert.equal((await req('/calls/config','')).status,401);
  assert.equal((await req('/calls/start',c.token,{device:dc,chat_id:chat})).status,404);
  const saved=(await req('/saved',a.token,{})).data.id;assert.equal((await req('/calls/start',a.token,{device:da,chat_id:saved})).status,404);
  const start=await req('/calls/start',a.token,{device:da,chat_id:chat});assert.equal(start.status,201);const id=start.data.id;
  assert.equal((await req('/calls/start',b.token,{device:db,chat_id:chat})).status,409);
  assert.equal((await req('/calls/current?device='+db,b.token)).data,null);
  assert.equal((await req(`/calls/${id}/offer`,c.token,{device:dc})).status,404);
  assert.equal((await req(`/calls/${id}/end`,a.token,{device:d()})).status,409);
  const offer={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};
  assert.equal((await req(`/calls/${id}/offer`,a.token,{device:da,description:{...offer,sdp:offer.sdp+'m=application 9 DTLS/SCTP 5000\r\n'}})).status,400);
  assert.equal((await req(`/calls/${id}/offer`,a.token,{device:da,description:offer})).status,200);
  assert.equal((await req(`/calls/${id}/screen`,a.token,{device:da,sharing:true})).status,409);
  assert.deepEqual((await req('/calls/current?device='+db,b.token)).data.offer,offer);
  assert.equal((await req('/calls/current?device='+dc,c.token)).data,null);
  assert.equal((await req(`/calls/${id}/answer`,b.token,{device:db,description:{...offer,type:'answer'}})).status,409);
  assert.equal((await req(`/calls/${id}/accept`,b.token,{device:db})).status,200);
  const other=(await req('/calls/current?device='+d(),b.token)).data;assert.equal(other.status,'other-device');assert.equal(other.offer,undefined);
  assert.equal((await req(`/calls/${id}/accept`,b.token,{device:d()})).status,409);
  assert.equal((await req(`/calls/${id}/answer`,b.token,{device:db,description:{...offer,type:'answer'}})).status,200);
  assert.equal((await req('/calls/current?device='+da,a.token)).data.answer.type,'answer');
  assert.equal((await req(`/calls/${id}/screen`,c.token,{device:dc,sharing:true})).status,404);
  assert.equal((await req(`/calls/${id}/screen`,a.token,{device:d(),sharing:true})).status,409);
  assert.equal((await req(`/calls/${id}/screen`,a.token,{device:da,sharing:'true'})).status,400);
  assert.equal((await req(`/calls/${id}/screen`,a.token,{device:da,sharing:true})).status,200);
  assert.equal((await req('/calls/current?device='+db,b.token)).data.peer_sharing,true);
  assert.equal((await req('/calls/current?device='+da,a.token)).data.peer_sharing,false);
  assert.equal((await req(`/calls/${id}/screen`,b.token,{device:db,sharing:true})).status,200);
  assert.equal((await req('/calls/current?device='+da,a.token)).data.peer_sharing,true);
  assert.equal((await req(`/calls/${id}/screen`,a.token,{device:da,sharing:false})).status,200);
  assert.equal((await req('/calls/current?device='+db,b.token)).data.peer_sharing,false);
  assert.equal((await req(`/calls/${id}/end`,b.token,{device:db})).status,200);assert.equal((await req('/calls/current?device='+da,a.token)).data,null);
  assert.equal((await req(`/calls/${id}/answer`,b.token,{device:db,description:{...offer,type:'answer'}})).status,404);
 }finally{await app.close();}
});
test('calls: timeout and TURN credentials with controlled clock',async()=>{
 const app=createApp({database:':memory:'});let now=1000000,result,status;const uid=Number(app.db.prepare("INSERT INTO users(username,name,phone) VALUES('one','One','+79000000001')").run().lastInsertRowid),peer=Number(app.db.prepare("INSERT INTO users(username,name,phone) VALUES('two','Two','+79000000002')").run().lastInsertRowid);
 const chat=Number(app.db.prepare("INSERT INTO chats(pair) VALUES('1:2')").run().lastInsertRowid);for(const id of [uid,peer])app.db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(chat,id);
 const service=calls({db:app.db,auth:()=>{},body:async req=>req.data,json:(_r,s,r)=>{result=r;status=s;},userById:id=>({id}),turnSecret:'secret-for-test',turnHost:'turn.example',clock:()=>now});
 const invoke=async(path,user,method='GET',data)=>{await service.handle({method,data},{},new URL('http://local/api/calls'+path),user);return result;};
 try{const config=await invoke('/config',uid);const credentials=config.iceServers[0];assert.equal(credentials.credential,createHmac('sha1','secret-for-test').update(credentials.username).digest('base64'));assert.equal(JSON.stringify(config).includes('secret-for-test'),false);
 const device=d();await invoke('/start',uid,'POST',{device,chat_id:chat});assert.equal(status,201);now+=61000;assert.equal(await invoke('/current?device='+device,uid),null);
 const next=await invoke('/start',uid,'POST',{device,chat_id:chat});const offer={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};await invoke('/'+next.id+'/offer',uid,'POST',{device,description:offer});now+=45000;await invoke('/current?device='+device,uid);now+=10000;const other=d();await invoke('/'+next.id+'/accept',peer,'POST',{device:other});now+=20000;await invoke('/'+next.id+'/answer',peer,'POST',{device:other,description:{...offer,type:'answer'}});assert.equal(result.status,'active');
 }finally{service.close();await app.close();}
});
