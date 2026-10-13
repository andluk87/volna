import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
test('reaction faces carry public avatars and follow insertion order rather than user ID',async()=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port+'/api';
 try{
  const register=async(username,name)=>(await fixtureFetch(base+'/register',{method:'POST',body:JSON.stringify({username,name})})).json();
  const a=await register('reaction_one','Первый'),b=await register('reaction_two','Второй');
  const request=async(path,token,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.ok,true,await response.clone().text());return response.json();};
  const chat=await request('/chats',a.token,{user_id:b.user.id});
  const message=await request(`/chats/${chat.id}/messages`,a.token,{text:'Реакции',client_id:crypto.randomUUID().replaceAll('-','')});
  await request(`/messages/${message.id}/react`,b.token,{emoji:'❤️',active:true});
  let updated=await request(`/messages/${message.id}/react`,a.token,{emoji:'❤️',active:true});
  assert.deepEqual(updated.reactions.map(r=>r.user_id),[b.user.id,a.user.id]);
  assert.deepEqual(updated.reactions.map(r=>r.name),['Второй','Первый']);
  assert.equal(updated.reactions[0].avatar_url,null);
  updated=await request(`/messages/${message.id}/react`,b.token,{emoji:'❤️',active:false});
  assert.equal(updated.reactions.length,1);assert.equal(updated.reactions[0].user_id,a.user.id);
 }finally{await app.close();}
});
