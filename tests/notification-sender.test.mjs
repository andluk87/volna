import test from 'node:test';import assert from 'node:assert/strict';import {createApp,fixtureFetch} from './phone-fixture.mjs';
test('message metadata separates the login handle from display name without changing typed mentions',async()=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port+'/api';
 try{
  const register=async(username,name)=>(await fixtureFetch(base+'/register',{method:'POST',body:JSON.stringify({username,name})})).json();
  const owner=await register('notify_owner','Иван Иванов'),guest=await register('notify_guest','notify_guest');
  const request=async(path,token,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.ok,true,await r.clone().text());return r.json();};
  const chat=await request('/chats',owner.token,{user_id:guest.user.id});
  const row=await request(`/chats/${chat.id}/messages`,guest.token,{text:'Привет @notify_owner',client_id:crypto.randomUUID().replaceAll('-','')});
  assert.equal(row.sender_name,'notify_guest');assert.equal(row.sender_username,'notify_guest');assert.equal(row.text,'Привет @notify_owner');
  const history=await request(`/chats/${chat.id}/messages`,owner.token);const received=history.messages?.[0]||history[0];assert.equal(received.sender_username,'notify_guest');
 }finally{await app.close();}
});
