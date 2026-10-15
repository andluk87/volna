import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createNotificationStack}=createRequire(import.meta.url)('../client/electron/notification-stack.cjs');
test('Windows burst retains five messages in order and evicts their timers',()=>{
 let id=0;const tasks=new Map(),updates=[];
 const stack=createNotificationStack({publish:rows=>updates.push(rows.slice()),open:()=>{},timers:{setTimeout(fn,ms){tasks.set(++id,{fn,ms});return id;},clearTimeout:id=>tasks.delete(id)}});
 for(let n=1;n<=7;n++)stack.push({chatId:n,accountId:2,title:'Иван',body:'Сообщение '+n});
 assert.deepEqual(stack.snapshot().map(e=>e.body),[3,4,5,6,7].map(n=>'Сообщение '+n));
 assert.equal(tasks.size,5);assert.ok([...tasks.values()].every(t=>t.ms===6000));
 [...tasks.values()][0].fn();assert.deepEqual(stack.snapshot().map(e=>e.chatId),[4,5,6,7]);
 stack.clear();assert.equal(tasks.size,0);assert.deepEqual(updates.at(-1),[]);
});
test('Windows click opens the stored account/chat and stale or forged IDs do nothing',()=>{
 const opened=[];const stack=createNotificationStack({publish:()=>{},open:e=>opened.push(e),timers:{setTimeout:()=>1,clearTimeout:()=>{}}});
 const id=stack.push({chatId:21,accountId:9,title:'<script>',body:'Текст сообщения'});
 assert.equal(stack.activate(999),false);assert.equal(stack.activate(id),true);assert.equal(stack.activate(id),false);
 assert.equal(opened.length,1);assert.equal(opened[0].chatId,21);assert.equal(opened[0].accountId,9);assert.equal(opened[0].body,'Текст сообщения');
});
test('notification host stays inside the correct monitor, does not take focus and rejects foreign IPC',async t=>{
 const {EventEmitter}=await import('node:events');
 const {createNotificationWindow}=createRequire(import.meta.url)('../client/electron/notification-window.cjs');
 const windows=[],opened=[],ipc=new EventEmitter();
 class Window {
  constructor(options){this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(_channel,rows)=>this.rows=rows;windows.push(this);}
  isDestroyed(){return !!this.destroyed;}hide(){this.visible=false;}showInactive(){this.visible=true;this.inactive=true;}setBounds(bounds){this.bounds=bounds;}loadFile(){queueMicrotask(()=>this.webContents.emit('did-finish-load'));}destroy(){this.destroyed=true;}
 }
 const area={x:-1920,y:40,width:1920,height:1040},host=createNotificationWindow({BrowserWindow:Window,ipcMain:ipc,screen:{getDisplayMatching:()=>({workArea:area})},parent:()=>({isDestroyed:()=>false,getBounds:()=>({x:-1000,y:100,width:900,height:700})}),open:e=>opened.push(e)});t.after(()=>host.dispose());
 for(let n=1;n<=7;n++)host.push({chatId:n,accountId:2,body:'Сообщение '+n});await new Promise(r=>setImmediate(r));
 const window=windows[0];assert.equal(windows.length,1);assert.equal(window.rows.length,5);assert.equal(window.options.focusable,false);assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.inactive,true);
 assert.ok(window.bounds.x>=area.x&&window.bounds.x+window.bounds.width<=area.x+area.width);assert.ok(window.bounds.y>=area.y&&window.bounds.y+window.bounds.height<=area.y+area.height);
 const id=window.rows.at(-1).id;ipc.emit('vln:toast-open',{sender:{},senderFrame:window.webContents.mainFrame},id);assert.equal(opened.length,0);
 ipc.emit('vln:toast-open',{sender:window.webContents,senderFrame:{}},id);assert.equal(opened.length,0);
 ipc.emit('vln:toast-open',{sender:window.webContents,senderFrame:window.webContents.mainFrame},id);assert.equal(opened[0].chatId,7);assert.equal(opened[0].accountId,2);
});
