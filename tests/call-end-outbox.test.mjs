import test from 'node:test';
import assert from 'node:assert/strict';
import {CallEndOutbox} from '../client/src/call-end-outbox.mjs';
const id='a'.repeat(32),device='b'.repeat(32),intent={call_id:id,device,end_reason:'user_hangup'};
function storage(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
test('offline end survives reload, is isolated by account/server and persists no credentials',async()=>{
 const disk=storage();let now=100000;const options={scope:'https://one:1',storage:disk,now:()=>now};
 let q=new CallEndOutbox(options);q.add({...intent,token:'NEVER-STORE',text:'NEVER-STORE'});await q.flush(async()=>{throw new TypeError('offline');});assert.equal(q.has(id),true);assert.ok(!disk.getItem(disk.key(0)).includes('NEVER-STORE'));
 assert.equal(new CallEndOutbox({...options,scope:'https://one:2'}).has(id),false);assert.equal(new CallEndOutbox({...options,scope:'https://two:1'}).has(id),false);
 q=new CallEndOutbox(options);const sent=[];now+=2000;await q.flush(async value=>sent.push(value.call_id));assert.deepEqual(sent,[id]);assert.equal(q.has(id),false);assert.equal(disk.length,0);
});
test('dedup, concurrent flush, Retry-After, terminal ownership failure and expiry are bounded',async()=>{
 let now=0;const q=new CallEndOutbox({scope:'test',now:()=>now});q.add(intent);q.add(intent);let count=0;
 await q.flush(async()=>{count++;throw Object.assign(Error('limited'),{status:429,retryAfterMs:60000});});await q.flush(async()=>count++,{force:true});assert.equal(count,1,'online event cannot bypass rate pause');
 now=60000;let release;const pending=q.flush(()=>new Promise(r=>{release=r;}));const same=q.flush(()=>assert.fail('duplicate flush'));assert.equal(pending,same);release();await pending;assert.equal(q.has(id),false);
 q.add(intent);await q.flush(async()=>{throw Object.assign(Error('ownership'),{status:403});});assert.equal(q.has(id),false);
 q.add(intent);now+=86400001;await q.flush(()=>assert.fail('expired command'));assert.equal(q.entries().length,0);
});
