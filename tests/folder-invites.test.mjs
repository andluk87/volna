import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
test('folder links exclude private chats, preview before joining, respect revocation and synchronize color',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token='',data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const a=(await req('/register','',{username:'share_alice',name:'Alice',password:'long-test-password'})).data,b=(await req('/register','',{username:'share_boris',name:'Boris',password:'long-test-password'})).data;
 const group=(await req('/communities',a.token,{kind:'group',title:'Shared group',client_id:'folder-sharing-test-00001'})).data;
 const saved=(await req('/saved',a.token,{})).data;
 await req('/folders',a.token,{version:0,folders:[{id:'share',name:'Общая',color:'#7965db',chats:[group.id,saved.id]}]});
 assert.equal((await req('/folders/share/invites',a.token,{chats:[saved.id]})).status,403);
 const link=await req('/folders/share/invites',a.token,{chats:[group.id]});assert.equal(link.status,201);
 const path='/folder-invites/'+link.data.token;const preview=await req(path,b.token);assert.equal(preview.status,200);assert.equal(preview.data.chats[0].joined,false);
 assert.equal(app.db.prepare('SELECT 1 FROM members WHERE user_id=? AND chat_id=?').get(b.user.id,group.id),undefined);
 assert.equal((await req(path,b.token,{version:0,chats:[saved.id]})).status,400);
 const joined=await req(path,b.token,{version:0,chats:[group.id]});assert.equal(joined.status,200);assert.equal(joined.data.folders.at(-1).color,'#7965db');
 assert.equal((await req(path,b.token,{version:0,chats:[group.id]})).status,409);
 assert.equal((await req('/folders/share/invites/'+link.data.id,a.token,{})).status,200);assert.equal((await req(path,b.token)).status,410);
});
