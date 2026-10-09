import test from 'node:test';
import assert from 'node:assert/strict';
import {readDrafts,writeDrafts,clearDrafts} from '../client/src/drafts.mjs';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('drafts survive reload, stay account scoped, and are removed after sending/logout',()=>{
 const s=memory();writeDrafts(s,1,{4:{text:'Привет 👋',file:{id:7},reply:{id:9}}},100);
 assert.deepEqual(readDrafts(s,1,101),{4:{text:'Привет 👋',file:null,reply:null,edit:null}});
 assert.deepEqual(readDrafts(s,2,101),{});
 writeDrafts(s,2,{8:{text:'Другой аккаунт'}},100);
 writeDrafts(s,1,{4:{text:''}},102);assert.deepEqual(readDrafts(s,1,103),{});
 clearDrafts(s,2);assert.deepEqual(readDrafts(s,2,103),{});
});
test('edits and expired drafts are not restored; unavailable or corrupt storage is harmless',()=>{
 const s=memory();writeDrafts(s,1,{4:{text:'Редактирование',edit:{id:9}},5:{text:'Черновик'}},100);
 assert.deepEqual(Object.keys(readDrafts(s,1,101)),['5']);
 assert.deepEqual(readDrafts(s,1,100+7*86400000),{});
 s.setItem('volna.drafts.v1.1','null');assert.deepEqual(readDrafts(s,1),{});
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){throw Error('blocked');}};
 assert.deepEqual(readDrafts(blocked,1),{});assert.equal(writeDrafts(blocked,1,{4:{text:'hi'}}),false);clearDrafts(blocked,1);
});
