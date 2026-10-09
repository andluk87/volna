import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'volna-expressions-'));
 const app=createApp({database:':memory:',uploads:directory});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>{app.close();rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 async function request(path,token='',data){
  const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const value=response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data:value};
 }
 const users=[];for(const username of ['exp_alice','exp_boris','exp_carol'])users.push((await request('/register','',{username,name:username,password:'long-expression-password'})).data);
 async function upload(user,mime='image/png',bytes=readFileSync('server/assets/expressions/happy.png')){
  const response=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:`Bearer ${user.token}`,'Content-Type':mime,'X-File-Name':'sample.png'},body:bytes});assert.equal(response.status,201);return (await response.json()).id;
 }
 async function create(user,kind='sticker',isPublic=false,fallback='✨'){
  const id=await upload(user);
  return (await request('/expressions/packs',user.token,{title:'Свои эмоции',kind,public:isPublic,items:[{attachment_id:id,label:'Улыбка',keywords:['радость','смешно'],fallback}]})).data;
 }
 return {app,request,users,upload,create};
}

test('expressions: original starter packs, Unicode search and removals work without a GIF provider',async t=>{
 const {app,request,users:[a,b]}=await fixture(t);
 const packs=(await request('/expressions/packs',a.token)).data;
 assert.equal(packs.length,2);assert.deepEqual(packs.map(p=>p.items.length).sort((a,b)=>a-b),[8,12]);assert.ok(packs.every(p=>p.installed&&!p.own));
 const gif=(await request('/expressions?kind=gif&q='+encodeURIComponent('сердце'),a.token)).data;
 assert.equal(gif.items.length,2);assert.equal(gif.items[0].mime,'image/gif');assert.equal(gif.more,false);
 assert.ok((await request('/files/'+gif.items[0].attachment_id,b.token)).data.toString('ascii',0,3)==='GIF');
 await request('/expressions/packs/'+packs[0].id+'/remove',a.token,{});
 assert.equal((await request('/expressions/packs',a.token)).data.find(p=>p.id===packs[0].id).installed,false);
 assert.equal((await request('/expressions/packs',b.token)).data.every(p=>p.installed),true);
 assert.equal(app.db.prepare('SELECT count(*) AS n FROM expression_items').get().n,20);
 assert.equal((await request('/expressions?kind=bad',a.token)).status,400);
 assert.equal((await request('/expressions?offset=-1',a.token)).status,400);
});

test('expressions: private packs and media are isolated; sending is idempotent and reusable',async t=>{
 const {app,request,users:[a,b,c],create}=await fixture(t);
 const p=await create(a),item=p.items[0],chat=(await request('/chats',a.token,{user_id:b.user.id})).data.id;
 assert.equal((await request('/expressions/packs/'+p.id,b.token)).status,404);
 assert.equal((await request('/files/'+item.attachment_id,b.token)).status,404);
 assert.equal((await request('/expressions?kind=sticker&q='+encodeURIComponent('Свои эмоции'),b.token)).data.items.length,0);
 const body={text:'',expression_id:item.id,client_id:randomUUID()};
 const first=await request(`/chats/${chat}/messages`,a.token,body),repeat=await request(`/chats/${chat}/messages`,a.token,body);
 assert.equal(first.status,201);assert.equal(repeat.status,200);assert.equal(first.data.id,repeat.data.id);assert.equal(first.data.expression.kind,'sticker');
 assert.equal(app.db.prepare('SELECT count FROM expression_usage WHERE user_id=? AND item_id=?').get(a.user.id,item.id).count,1);
 assert.equal((await request('/files/'+item.attachment_id,b.token)).status,200);assert.equal((await request('/files/'+item.attachment_id,c.token)).status,404);
 assert.equal((await request(`/chats/${chat}/messages`,b.token,{...body,client_id:randomUUID()})).status,404);
 assert.equal((await request(`/chats/${chat}/messages`,a.token,{...body,client_id:randomUUID()})).status,201);
 assert.equal((await request(`/chats/${chat}/messages`,a.token,{text:'',attachment_id:item.attachment_id,client_id:randomUUID()})).status,403);
 assert.equal((await request('/uploads/'+item.attachment_id+'/discard',a.token,{})).status,409);
 await request('/messages/'+first.data.id+'/delete',a.token,{});
 assert.equal((await request('/files/'+item.attachment_id,a.token)).status,200);
});

test('expressions: custom emoji retain UTF-16 offsets through trim, edit, retry and authorized forwarding',async t=>{
 const {app,request,users:[a,b,c],create}=await fixture(t);
 const p=await create(a,'emoji',false,'👍🏽'),item=p.items[0],ab=(await request('/chats',a.token,{user_id:b.user.id})).data.id;
 const payload={text:'  Я 👍🏽!  ',emoji_entities:[{id:item.id,start:4,length:4}],client_id:randomUUID()};
 const first=await request(`/chats/${ab}/messages`,a.token,payload);
 assert.equal(first.status,201);assert.equal(first.data.text,'Я 👍🏽!');assert.equal(first.data.emoji_entities[0].start,2);assert.equal(first.data.emoji_entities[0].length,4);assert.equal(first.data.emoji_entities[0].attachment_id,item.attachment_id);
 assert.equal((await request(`/chats/${ab}/messages`,a.token,payload)).status,200);
 assert.equal((await request('/files/'+item.attachment_id,b.token)).status,200);assert.equal((await request('/files/'+item.attachment_id,c.token)).status,404);
 const bc=(await request('/chats',b.token,{user_id:c.user.id})).data.id;
 const forwarded=await request('/messages/'+first.data.id+'/forward',b.token,{chat_id:bc,client_id:randomUUID()});
 assert.equal(forwarded.status,201);assert.equal(forwarded.data.emoji_entities.length,1);assert.equal((await request('/files/'+item.attachment_id,c.token)).status,200);
 assert.equal((await request('/messages/'+first.data.id,c.token)).status,404);
 const edit=await request('/messages/'+first.data.id+'/edit',a.token,{text:'Привет 👍🏽',emoji_entities:[{id:item.id,start:7,length:4}]});
 assert.equal(edit.status,200);assert.equal(edit.data.emoji_entities[0].start,7);
 for(const bad of [null,{},[{id:item.id,start:-1,length:4}],[{id:item.id,start:0,length:99}],[{id:item.id,start:0,length:2}],[{id:item.id,start:7,length:4},{id:item.id,start:7,length:4}]]){
  assert.equal((await request('/messages/'+first.data.id+'/edit',a.token,{text:'Привет 👍🏽',emoji_entities:bad})).status,400);
 }
 assert.equal((await request('/messages/'+first.data.id,a.token)).data.emoji_entities[0].start,7);
 assert.equal(app.db.prepare('SELECT count(*) AS n FROM message_emoji').get().n,2);
 const removed=await request('/messages/'+first.data.id+'/delete',a.token,{});assert.deepEqual(removed.data.emoji_entities,[]);
});

test('expressions: file ownership, magic, favorites and pack-creation retries are enforced',async t=>{
 const {request,users:[a,b],upload}=await fixture(t);
 const id=await upload(a),body={title:'Сердечки',kind:'emoji',public:true,client_id:randomUUID(),items:[{attachment_id:id,label:'Сердце',keywords:['любовь'],fallback:'❤️'}]};
 const created=await request('/expressions/packs',a.token,body);assert.equal(created.status,201);
 const again=await request('/expressions/packs',a.token,body);assert.equal(again.status,200);assert.equal(again.data.id,created.data.id);
 assert.equal((await request('/expressions/packs',a.token,{...body,title:'Другое'})).status,409);
 assert.equal((await request('/expressions/packs',b.token,{...body,client_id:randomUUID()})).status,400);
 const item=created.data.items[0];assert.equal((await request('/expressions/'+item.id+'/favorite',b.token,{active:true})).status,200);
 assert.equal((await request('/expressions?kind=emoji&section=favorite',b.token)).data.items[0].id,item.id);
 assert.equal((await request('/expressions?kind=emoji&section=favorite',a.token)).data.items.length,0);
 const fake=await upload(a,'image/gif',Buffer.from('not a GIF'));
 assert.equal((await request('/expressions/packs',a.token,{...body,kind:'gif',client_id:randomUUID(),items:[{attachment_id:fake,fallback:'✨'}]})).status,400);
 assert.equal((await request('/expressions/packs',a.token,{...body,client_id:randomUUID(),items:[{attachment_id:id,fallback:'https://example.com'}]})).status,400);
 assert.equal((await request('/expressions/packs',a.token,{...body,client_id:randomUUID(),items:[{attachment_id:id,fallback:'❤️❤️'}]})).status,400);
});
