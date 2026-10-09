import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('service worker displays private push and opens a validated same-origin chat',async()=>{
 const handlers={},shown=[],opened=[],messages=[];let focused=0;
 const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://volna.lknet.ru'},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async path=>opened.push(path)}};
 vm.runInNewContext(readFileSync(new URL('../client/public/sw.js',import.meta.url),'utf8'),{self,URL,Response,Date,Number,String});
 let pending;const waitUntil=p=>pending=p;
 handlers.push({data:{json:()=>({title:'Волна',body:'Новое сообщение',tag:'chat-7',chat_id:7})},waitUntil});await pending;
 assert.equal(shown[0].title,'Волна');assert.equal(shown[0].options.body,'Новое сообщение');
 let closed=false;handlers.notificationclick({notification:{data:shown[0].options.data,close:()=>closed=true},waitUntil});await pending;assert.equal(opened[0],'/app?chat=7');assert.ok(closed);
 self.clients.matchAll=async()=>[{url:'https://volna.lknet.ru/app',focus:async()=>focused++,postMessage:m=>messages.push(m)}];
 handlers.notificationclick({notification:{data:{chat_id:8},close:()=>{}},waitUntil});await pending;assert.equal(focused,1);assert.equal(messages[0].chat_id,8);
 self.clients.matchAll=async()=>[];handlers.notificationclick({notification:{data:{chat_id:'https://evil.test/'},close:()=>{}},waitUntil});await pending;assert.equal(opened.at(-1),'/app');
 handlers.push({data:{json:()=>({kind:'call',expires:Date.now()-10})},waitUntil});await pending;assert.equal(shown.at(-1).options.body,'Пропущенный аудиозвонок');
});
