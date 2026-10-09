import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('polls and checklists persist, authorize members and support retry, voting and forwarding',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-interactive-')),options={database:join(dir,'db'),uploads:join(dir,'uploads')};let app,base;
 const start=async()=>{app=createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;};
 const call=async(path,token,data)=>{const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};};
 try{
  await start();const users=[];for(const username of ['pollalice','pollbob','polleve'])users.push((await call('/register','',{username,password:'long-password'})).data);const [a,b,e]=users;
  const chat=(await call('/chats',a.token,{user_id:b.user.id})).data.id;
  const poll={question:'Когда встречаемся?',options:[{text:'Сегодня'},{text:'Завтра'}]},payload={poll,client_id:randomUUID()};
  const sent=await call(`/chats/${chat}/messages`,a.token,payload);assert.equal(sent.status,201);const id=sent.data.id;assert.equal(sent.data.poll.question,poll.question);
  assert.equal((await call(`/messages/${id}/vote`,e.token,{option:0})).status,404);
  assert.equal((await call(`/messages/${id}/vote`,b.token,{option:2})).status,400);
  let vote=await call(`/messages/${id}/vote`,b.token,{option:0});assert.deepEqual(vote.data.poll.options[0].voters,[b.user.id]);
  vote=await call(`/messages/${id}/vote`,b.token,{option:1});assert.deepEqual(vote.data.poll.options[0].voters,[]);assert.deepEqual(vote.data.poll.options[1].voters,[b.user.id]);
  assert.equal((await call(`/chats/${chat}/messages`,a.token,payload)).data.id,id);
  assert.equal((await call(`/chats/${chat}/messages`,a.token,{...payload,poll:{...poll,question:'Другой вопрос'}})).status,409);
  assert.equal((await call(`/chats/${chat}/messages`,a.token,{client_id:randomUUID(),poll:{question:'?',options:[{text:'да'},{text:'ДА'}]}})).status,400);
  const listPayload={checklist:{title:'Покупки',items:[{text:'Хлеб',done:true},{text:'Молоко'}]},client_id:randomUUID()};
  const list=await call(`/chats/${chat}/messages`,a.token,listPayload);assert.equal(list.status,201);assert.equal(list.data.checklist.items[0].done,false);
  assert.equal((await call(`/messages/${list.data.id}/check`,e.token,{item:0,done:true})).status,404);
  assert.equal((await call(`/messages/${list.data.id}/check`,b.token,{item:-1,done:true})).status,400);
  assert.equal((await call(`/messages/${list.data.id}/check`,b.token,{item:0,done:'yes'})).status,400);
  assert.equal((await call(`/messages/${list.data.id}/check`,b.token,{item:0,done:true})).data.checklist.items[0].done,true);
  assert.equal((await call(`/chats/${chat}/messages`,a.token,listPayload)).data.id,list.data.id);
  assert.equal((await call(`/messages/${list.data.id}/edit`,a.token,{text:'bad'})).status,400);
  const saved=(await call('/saved',b.token,{})).data.id;
  const forwarded=await call(`/messages/${id}/forward`,b.token,{chat_id:saved,client_id:randomUUID()});assert.equal(forwarded.status,201);assert.deepEqual(forwarded.data.poll.options[1].voters,[]);
  await app.close();await start();
  const restored=(await call(`/chats/${chat}/messages`,b.token)).data;assert.equal(restored.find(m=>m.id===list.data.id).checklist.items[0].done,true);assert.deepEqual(restored.find(m=>m.id===id).poll.options[1].voters,[b.user.id]);
  assert.deepEqual((await call(`/messages/${id}/vote`,b.token,{option:null})).data.poll.options[1].voters,[]);
  await call(`/messages/${id}/delete`,a.token,{});assert.equal((await call(`/messages/${id}/vote`,b.token,{option:0})).status,410);assert.equal((await call(`/messages/${id}`,a.token)).data.poll,null);
 }finally{await app?.close();rmSync(dir,{recursive:true,force:true});}
});
