import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),{normalizeDesktopPreferences,desktopPreferences}=require('../client/electron/desktop-preferences.cjs'),{monochromeTray}=require('../client/electron/monochrome-tray.cjs'),{createUpdates}=require('../client/electron/updates.cjs');
test('desktop preferences preserve access to the app, clamp zoom and survive an atomic write',t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-desktop-prefs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'settings.json'),store=desktopPreferences(file);assert.equal(store.get().autoUpdate,true);const result=store.set({tray:false,taskbar:false,scale:999,language:'en',evil:'discarded'});assert.equal(result.taskbar,true);assert.equal(result.scale,2);assert.equal(result.language,'en');assert.equal(JSON.parse(readFileSync(file)).evil,undefined);assert.deepEqual(desktopPreferences(file).get(),result);assert.equal(normalizeDesktopPreferences({scale:NaN}).scale,1);assert.equal(monochromeTray(true).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.notDeepEqual(monochromeTray(true),monochromeTray(false));
});
test('disabled automatic updates allow explicit checks and never downgrade',async()=>{
 const updater=Object.assign(new EventEmitter(),{checks:0,checkForUpdates:async function(){this.checks++;}});const updates=createUpdates({updater,version:'1',supported:true,publish:()=>{},install:()=>{},autoUpdate:false});await updates.check();assert.equal(updater.checks,0);await updates.check(true);assert.equal(updater.checks,1);assert.equal(updater.allowDowngrade,false);updates.setAutoUpdate(true);await updates.check();assert.equal(updater.checks,2);
});
