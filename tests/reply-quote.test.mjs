import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
import {replyQuote,validQuote} from '../shared/reply-quote.mjs';

test('quote validation rejects forged fragments and split emoji',()=>{
 assert.equal(validQuote('😀 тест',{offset:0,text:'😀'}),true);
 assert.equal(validQuote('😀 тест',{offset:0,text:'\ud83d'}),false);
 assert.throws(()=>replyQuote({text:' ',offset:0}));assert.throws(()=>replyQuote({text:'a',offset:-1}));
 assert.throws(()=>replyQuote({text:'a'.repeat(1025),offset:0}));
});
test('reply fragments persist, retry safely, survive edits and respect source permissions',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const users=[];for(const username of ['quotealice','quoteboris','quotecarol'])users.push((await req('/register','',{username,password:'password-long-enough'})).data);
 const [a,b,c]=users,chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id;
 const text='Мука\nМолоко\nТуалетная бумага\nМолоко',fragment={text:'Туалетная бумага',offset:text.indexOf('Туалетная')};
 const original=(await req(`/chats/${chat}/messages`,a.token,{text,client_id:randomUUID()})).data;
 const payload={text:'Куплю',reply_to:original.id,reply_quote:fragment,client_id:randomUUID()};
 const answer=await req(`/chats/${chat}/messages`,b.token,payload);assert.equal(answer.status,201);assert.equal(answer.data.reply.text,fragment.text);assert.deepEqual(answer.data.reply.quote,fragment);
 const retry=await req(`/chats/${chat}/messages`,b.token,payload);assert.equal(retry.data.id,answer.data.id);
 assert.equal((await req(`/chats/${chat}/messages`,b.token,{...payload,reply_quote:{text:'Мука',offset:0}})).status,409);
 assert.equal((await req(`/chats/${chat}/messages`,b.token,{...payload,client_id:randomUUID(),reply_quote:{text:'Подделка',offset:0}})).status,400);
 assert.equal((await req(`/chats/${chat}/messages`,b.token,{text:'No source',reply_quote:fragment,client_id:randomUUID()})).status,400);
 const other=(await req('/chats',b.token,{user_id:c.user.id})).data.id;
 const moved=await req(`/chats/${other}/messages`,b.token,{...payload,client_id:randomUUID()});assert.equal(moved.status,201);
 const received=(await req(`/messages/${moved.data.id}`,c.token)).data;assert.equal(received.reply.text,fragment.text);assert.equal(received.reply.can_jump,false);
 assert.equal((await req(`/messages/${original.id}`,c.token)).status,404);
 assert.equal((await req(`/chats/${other}/messages`,c.token,{...payload,client_id:randomUUID()})).status,404);
 await req(`/messages/${original.id}/edit`,a.token,{text:'Список изменён'});
 assert.equal((await req(`/messages/${answer.data.id}`,b.token)).data.reply.text,fragment.text);
 // Retrying the original send after source editing still returns the same answer.
 assert.equal((await req(`/chats/${chat}/messages`,b.token,payload)).data.id,answer.data.id);
 await req(`/messages/${original.id}/delete`,a.token,{});
 const deleted=(await req(`/messages/${answer.data.id}`,b.token)).data;assert.equal(deleted.reply.text,'Сообщение удалено');assert.equal(deleted.reply.quote,null);assert.equal(deleted.reply_quote,null);
});
