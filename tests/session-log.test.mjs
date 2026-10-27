import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {createSessionLog}=createRequire(import.meta.url)('../client/electron/session-log.cjs');
test('session diagnostic fields omit credentials, message content and arbitrary exception text',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'volna-log-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const log=createSessionLog({directory,version:'test'});
 assert.equal(log.write('refresh-ok',{accountId:2,status:200,token:'PRIVATE_ACCESS',refresh_token:'PRIVATE_REFRESH',message:'private message',url:'https://host/?secret=123',error:Error('private exception')}),true);
 const text=readFileSync(log.file,'utf8'),row=JSON.parse(text);assert.deepEqual(Object.keys(row).sort(),['utc','version','event','accountId','status'].sort());assert.equal(text.includes('PRIVATE'),false);assert.equal(text.includes('private'),false);assert.equal(text.includes('secret'),false);assert.equal(log.write('arbitrary-private-data'),false);
});
test('session diagnostic log rotates and unwritable paths never break authorization',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'volna-log-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const log=createSessionLog({directory,version:'test',maxBytes:80});for(let i=0;i<8;i++)assert.equal(log.write('refresh-start',{accountId:1}),true);assert.ok(existsSync(path.join(directory,'session.previous.log')));assert.ok(readFileSync(log.file).length<256);const bad=createSessionLog({directory:log.file,version:'test'});assert.equal(bad.write('app-start'),false);
});
