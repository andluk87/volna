import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {restoredBounds,readWindowState,trackWindowState,desktopShortcut}=createRequire(import.meta.url)('../client/electron/window-state.cjs');
test('desktop window remains visible after unplugging a monitor and respects negative monitor coordinates',()=>{
 const primary={x:0,y:0,width:1920,height:1040},left={x:-1280,y:0,width:1280,height:984};
 const saved={x:-1200,y:70,width:1000,height:750};
 assert.deepEqual(restoredBounds(saved,[primary,left]),saved);
 const restored=restoredBounds(saved,[primary]);assert.ok(restored.x>=0&&restored.y>=0);assert.ok(restored.x+restored.width<=1920);
 assert.deepEqual(restoredBounds(null,[{x:0,y:0,width:800,height:600}]),{x:0,y:0,width:800,height:600});
 assert.deepEqual(restoredBounds({x:NaN,y:0,width:1000,height:600},[primary]),restoredBounds(null,[primary]));
});
test('desktop saves normal geometry while maximized and tolerates missing state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-window-')),file=join(dir,'window.json');
 try{assert.deepEqual(readWindowState(file),{});const win=new EventEmitter();win.isDestroyed=()=>false;win.getNormalBounds=()=>({x:20,y:30,width:1180,height:800});win.isMaximized=()=>true;trackWindowState(win,file);win.emit('close');assert.equal(JSON.parse(readFileSync(file)).maximized,true);assert.equal(readWindowState(file).width,1180);win.emit('closed');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('desktop shortcuts ignore keyup, auto repeat and conflicting modifiers',()=>{
 const key=(value,extra={})=>({type:'keyDown',key:value,control:true,...extra});
 assert.equal(desktopShortcut(key('k')),'search');assert.equal(desktopShortcut(key('f')),'chat-search');assert.equal(desktopShortcut(key(',')),'settings');
 assert.equal(desktopShortcut(key('ArrowDown',{control:false,alt:true})),'next-chat');
 for(const extra of [{type:'keyUp'},{isAutoRepeat:true},{meta:true},{alt:true}])assert.equal(desktopShortcut(key('k',extra)),null);
});
