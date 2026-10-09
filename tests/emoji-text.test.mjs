import test from 'node:test';import assert from 'node:assert/strict';
import {segments,boundaries,isEmoji,replaceText,reconcileEntities,deleteGrapheme,snapSelection} from '../shared/emoji-text.mjs';
import {readDrafts,writeDrafts} from '../client/src/drafts.mjs';
test('emoji editor: whole UTF16 graphemes, flags, family, skin, keycap and VS are preserved',()=>{
 for(const value of ['👨‍👩‍👧‍👦','👍🏽','🇷🇺','1️⃣','❤️','🏳️‍🌈']){assert.equal(isEmoji(value),true,value);assert.equal(segments(value).length,1);assert.deepEqual([...boundaries(value)],[0,value.length]);assert.equal(deleteGrapheme('a'+value+'b',[],1+value.length,1+value.length,'backward').text,'ab');assert.equal(deleteGrapheme(value+'b',[],0,0,'forward').text,'b');assert.deepEqual(snapSelection(value,1,1),[0,value.length]);}
 for(const value of ['hi','😀😀','<script>','a👍'])assert.equal(isEmoji(value),false);
});
test('emoji editor: cursor insertion, deletion, typing and modifier edits retain only intact entities',()=>{
 const id='a'.repeat(32),entity={id,start:2,length:4},text='a 👍🏽 z';
 const added=replaceText(text,[entity],0,0,'x');assert.equal(added.entities[0].start,3);
 const deleted=replaceText(text,[entity],3,4,'');assert.equal(deleted.text,'a  z');assert.deepEqual(deleted.entities,[]);
 assert.equal(reconcileEntities(text,'a 👍🏽 yz',[entity]).entities[0].start,2);
 assert.equal(reconcileEntities(text,'👍🏽 z',[entity]).entities[0].start,0);
 assert.deepEqual(reconcileEntities('👍','👍🏽',[{id,start:0,length:2}]).entities,[]);
 assert.deepEqual(reconcileEntities(text,'a 👋 z',[entity]).entities,[]);
 const family='👨‍👩‍👧‍👦';assert.equal(reconcileEntities(family,family+'!',[]).text,family+'!');
});
test('emoji drafts: minimal entity identities survive tab reload without media or account tokens',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},id='a'.repeat(32);
 writeDrafts(storage,1,{2:{text:'👍🏽',entities:[{id,start:0,length:4,attachment_id:'private',token:'secret'}]}},10);
 assert.deepEqual(readDrafts(storage,1,11)[2].entities,[{id,start:0,length:4}]);assert.ok(![...map.values()][0].includes('secret'));assert.deepEqual(readDrafts(storage,2,11),{});
});
import {demoRequest,resetDemo,DEMO_TOKEN} from '../client/src/demo-api.mjs';
test('emoji demo: catalog, installation and message entities remain isolated from live accounts',async()=>{resetDemo();const pack=(await demoRequest('/v1/emoji/packs')).packs[0];assert.equal(pack.items.length,24);const item=pack.items[0];await demoRequest('/v1/emoji/packs/'+pack.id+'/install',undefined,'DELETE');assert.equal((await demoRequest('/v1/emoji/packs')).packs[0].installed,false);const message=await demoRequest('/chats/1/messages',{text:item.fallback,emoji_entities:[{id:item.id,start:0,length:item.fallback.length}],client_id:'emoji-demo-message-01'},'POST');assert.equal(message.emoji_entities[0].attachment_id,item.attachment_id);assert.ok(DEMO_TOKEN.includes('demo'));resetDemo();});
