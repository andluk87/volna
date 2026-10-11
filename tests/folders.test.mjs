import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFolders,folderMatches,folderChats} from '../shared/folders.mjs';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
import {createRequire} from 'node:module';
const {registryEnabled}=createRequire(import.meta.url)('../client/electron/notification-state.cjs');
test('folders: explicit inclusion overrides filters; exclusions override pins; automatic contacts and pin order',()=>{
 const [f]=normalizeFolders([{id:'test',name:'Тест',types:['contacts'],chats:[3],excluded:[4],pinned:[2,1,4],excludeRead:true,excludeMuted:true,excludeArchived:true}]);
 const c={kind:'direct',is_contact:true,unread:1,muted:false,archived:false};
 assert.equal(folderMatches(f,{...c,id:5}),true);assert.equal(folderMatches(f,{...c,id:5,unread:0}),false);assert.equal(folderMatches(f,{...c,id:5,is_contact:false}),false);
 assert.equal(folderMatches(f,{...c,id:3,unread:0,muted:true,archived:true}),true);assert.equal(folderMatches(f,{...c,id:4}),false);assert.equal(folderMatches(f,{...c,id:3,parent_id:9}),false);
 assert.deepEqual(folderChats([1,3,2,5,4].map(id=>({...c,id})),f).map(c=>c.id),[2,1,3,5]);
});
test('folders: account isolation, cross-session updates, conflicts and deleted defaults stay deleted',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token='',data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const a=(await req('/register','',{username:'folder_alice',name:'Alice',password:'long-test-password'})).data,b=(await req('/register','',{username:'folder_boris',name:'Boris',password:'long-test-password'})).data;
 assert.equal((await req('/folders')).status,401);
 const first=(await req('/folders',a.token)).data;assert.equal(first.version,0);assert.equal(first.folders.length,6);
 assert.equal((await req('/folders',a.token,{version:0,folders:[]})).status,200);
 const again=(await req('/login','',{username:'folder_alice',password:'long-test-password'})).data;
 assert.deepEqual((await req('/folders',again.token)).data,{version:1,folders:[]});
 assert.equal((await req('/folders',a.token,{version:0,folders:first.folders})).status,409);
 assert.equal((await req('/folders',b.token)).data.folders.length,6);
 const privateChat=(await req('/saved',b.token,{})).data;
 assert.equal((await req('/folders',a.token,{version:1,folders:[{id:'foreign',name:'Чужая',chats:[privateChat.id]}]})).status,400);
 assert.equal((await req('/folders',a.token,{version:1,folders:[{id:'same',name:'One'},{id:'same',name:'Two'}]})).status,400);
});
test('Windows notification status distinguishes disabled, enabled and unknown registry settings',()=>{assert.equal(registryEnabled(' Enabled    REG_DWORD    0x0'),false);assert.equal(registryEnabled(' ToastEnabled    REG_DWORD    0x1'),true);assert.equal(registryEnabled('Not found'),null);});
