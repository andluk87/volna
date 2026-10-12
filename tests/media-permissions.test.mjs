import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const {mediaPermissions}=createRequire(import.meta.url)('../client/electron/media-permissions.cjs');
test('Windows media consent survives restart/update and never grants unknown devices or corrupt values',t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-consent-')),file=join(dir,'permissions.json');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const first=mediaPermissions(file);assert.equal(first.has('audio'),false);assert.equal(first.grant('audio'),true);
 const restarted=mediaPermissions(file);assert.equal(restarted.has('audio'),true);assert.equal(restarted.has('video'),false);assert.equal(restarted.grant('camera'),false);
 restarted.grant('video');assert.equal(mediaPermissions(file).has('video'),true);
 writeFileSync(file,'{"audio":"true","video":1}');assert.equal(mediaPermissions(file).has('audio'),false);
 writeFileSync(file,'broken');assert.equal(mediaPermissions(file).has('video'),false);
});
