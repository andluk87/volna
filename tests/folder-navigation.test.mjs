import test from 'node:test';import assert from 'node:assert/strict';import {folderNavigation,normalizeFolders} from '../shared/folders.mjs';
const chats=[1,2,3].map(id=>({id,kind:'direct',unread:1}));
test('folder navigation hides empty folders, deduplicates All and shows only unassigned chats',()=>{
 assert.deepEqual(folderNavigation(chats,[]),{tabs:[],remaining:chats});
 assert.equal(folderNavigation(chats,normalizeFolders([{id:'work',name:'Работа',chats:[]}])).tabs.length,0);
 const f=normalizeFolders([{id:'builtin_all',name:'Все чаты',rule:'all'},{id:'duplicate',name:'Все чаты'},{id:'work',name:'Работа',chats:[1]}]);const n=folderNavigation(chats,f);
 assert.deepEqual(n.tabs.map(t=>t.name),['Все чаты','Работа']);assert.deepEqual(n.remaining.map(c=>c.id),[2,3]);
 f.find(f=>f.id==='work').chats=[];assert.equal(folderNavigation(chats,f).tabs.length,0);
});
test('folder navigation respects exclusions and overlapping memberships',()=>{
 const f=normalizeFolders([{id:'a',name:'А',chats:[1,2],excluded:[2]},{id:'b',name:'Б',chats:[1,3]}]);assert.deepEqual(folderNavigation(chats,f).remaining.map(c=>c.id),[2]);
});
