import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFolders,chatsInFolder} from '../client/src/sidebar-state.mjs';
import {filterChats,adjacentMessage} from '../client/src/chat-layout.mjs';
import {resetDemo,demoRequest} from '../client/src/demo-api.mjs';
test('local folder corruption, duplicate IDs and unknown folders do not hide the chat list',()=>{
 assert.deepEqual(normalizeFolders(null),[]);
 const input=[{id:'folder-work',name:' Работа ',chats:[1,1,2,'3',null]},{id:'folder-work',name:'Duplicate',chats:[3]},{id:'other',name:'Bad',chats:[3]}];
 const folders=normalizeFolders(input);assert.deepEqual(folders,[{id:'folder-work',name:'Работа',chats:[1,2]}]);assert.equal(input[0].name,' Работа ');
 const chats=[{id:1},{id:2},{id:3}];assert.deepEqual(chatsInFolder(chats,folders,'folder-work'),chats.slice(0,2));assert.equal(chatsInFolder(chats,folders,'removed'),chats);
 assert.equal(filterChats([{id:1,archived:true,kind:'direct'}],'all','',true).length,1);assert.equal(filterChats([{id:1,archived:true,kind:'direct'}]).length,0);
 assert.equal(normalizeFolders(Array.from({length:20},(_,i)=>({id:'folder-'+i,name:'x'.repeat(100),chats:[]}))).length,12);
});
test('last message grouping safely handles absent next message, reply and day boundaries',()=>{
 const a={id:1,sender_id:2,created_at:'2026-10-09T00:00:00Z'},b={...a,id:2,created_at:'2026-10-09T00:01:00Z'};
 assert.equal(adjacentMessage(a,undefined),false);assert.equal(adjacentMessage(undefined,b),false);assert.equal(adjacentMessage(a,b),true);assert.equal(adjacentMessage(a,{...b,reply:{id:1}}),false);assert.equal(adjacentMessage(a,{...b,created_at:'2026-10-10T00:01:00Z'}),false);
});
test('demo poll creates, changes a single vote, cancels and forwards with independent results',async()=>{
 resetDemo();const seeded=(await demoRequest('/chats/3/messages')).find(m=>m.poll);assert.ok(seeded);
 const created=await demoRequest('/chats/3/messages',{client_id:'poll-test',poll:{question:' Режим? ',options:[{text:' Компактный '},{text:'Стандартный'}]}},'POST');assert.equal(created.poll.question,'Режим?');assert.deepEqual(created.poll.options[0].voters,[]);
 let m=await demoRequest(`/messages/${created.id}/vote`,{option:0},'POST');assert.deepEqual(m.poll.options[0].voters,[-1]);
 m=await demoRequest(`/messages/${created.id}/vote`,{option:1},'POST');assert.deepEqual(m.poll.options[0].voters,[]);assert.deepEqual(m.poll.options[1].voters,[-1]);
 await assert.rejects(demoRequest(`/messages/${created.id}/vote`,{option:4},'POST'),/Неверный/);
 const forwarded=await demoRequest(`/messages/${created.id}/forward`,{chat_id:1,client_id:'poll-forward'},'POST');assert.equal(forwarded.poll.question,'Режим?');assert.deepEqual(forwarded.poll.options[1].voters,[]);
 m=await demoRequest(`/messages/${created.id}/vote`,{option:null},'POST');assert.deepEqual(m.poll.options[1].voters,[]);
 await assert.rejects(demoRequest('/chats/3/messages',{poll:{question:'?',options:[{text:'Same'},{text:'same'}]}},'POST'),/Проверьте/);
 await demoRequest(`/messages/${created.id}/delete`,{},'POST');await assert.rejects(demoRequest(`/messages/${created.id}/vote`,{option:0},'POST'),/Неверный/);
});
