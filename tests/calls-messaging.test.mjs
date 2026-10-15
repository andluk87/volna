import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
test('active voice call preserves message streams and delivery/read acknowledgements in both directions',async()=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.server.address().port}/api`,controller=new AbortController();
 async function req(path,token,data){const response=await fixtureFetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const value=await response.json();assert.ok(response.ok,JSON.stringify({path,status:response.status,value}));return value;}
 async function stream(token){const response=await fetch(base+'/events',{headers:{Authorization:'Bearer '+token},signal:controller.signal});const reader=response.body.getReader();let buffer='';return async (type,messageId)=>{for(;;){let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.startsWith('data: ')){const event=JSON.parse(frame.slice(6));if(event.type===type&&(!messageId||event.message?.id===messageId))return event;}}const {done,value}=await reader.read();assert.equal(done,false);buffer+=new TextDecoder().decode(value);}};}
 try{
  const a=await req('/register','',{username:'call_message_a'}),b=await req('/register','',{username:'call_message_b'});
  const chat=await req('/chats',a.token,{user_id:b.user.id}),da=randomUUID().replaceAll('-',''),db=randomUUID().replaceAll('-','');
  const call=await req('/calls/start',a.token,{device:da,chat_id:chat.id});
  const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
  await req(`/calls/${call.id}/offer`,a.token,{device:da,description:{type:'offer',sdp}});
  await req(`/calls/${call.id}/accept`,b.token,{device:db});await req(`/calls/${call.id}/answer`,b.token,{device:db,description:{type:'answer',sdp}});
  const receiveA=await stream(a.token),receiveB=await stream(b.token);await receiveA('ready');await receiveB('ready');
  for(let n=0;n<6;n++){
   const [sender,recipient,receive,device]=n%2?[b,a,receiveA,db]:[a,b,receiveB,da];
   const text='Сообщение во время разговора '+n;
   const [message,current]=await Promise.all([req(`/chats/${chat.id}/messages`,sender.token,{text,client_id:randomUUID()}),req('/calls/current?device='+device,sender.token)]);
   assert.equal(current.status,'active');const event=await receive('message',message.id);assert.equal(event.message.text,text);assert.equal(event.message.id,message.id);
   await req(`/chats/${chat.id}/delivered`,recipient.token,{message_id:message.id});
   let row=(await req('/chats',sender.token)).find(c=>c.id===chat.id);assert.ok(row.peer_delivered>=message.id);assert.ok(row.peer_read<message.id,'delivery must not imply reading behind the call screen');
   await req(`/chats/${chat.id}/read`,recipient.token,{message_id:message.id});row=(await req('/chats',sender.token)).find(c=>c.id===chat.id);assert.ok(row.peer_read>=message.id);
  }
  await req(`/calls/${call.id}/end`,a.token,{device:da});
 } finally {controller.abort();await app.close();}
});
