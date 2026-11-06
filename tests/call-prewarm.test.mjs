import test from 'node:test';
import assert from 'node:assert/strict';
import {CallPrewarm} from '../client/src/call-prewarm.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('prewarm reuses only the same call and account, and hands off resources without closing them',async()=>{
 const closed=[];const warm=new CallPrewarm(v=>closed.push(v));let created=0;const value={peer:'one'};
 warm.start('call-a','session-a',async()=>{created++;return value;});warm.start('call-a','session-a',async()=>{created++;throw Error()});
 assert.equal(await warm.get('call-a','session-a'),value);assert.equal(created,1);assert.equal(await warm.get('call-a','session-b'),null);assert.equal(await warm.get('call-b','session-a'),null);
 assert.equal(warm.claim('call-a','session-a'),true);warm.clear();assert.deepEqual(closed,[]);
});
test('decline/account switch releases pending and ready prewarmed resources, failed warmup permits normal fallback',async()=>{
 const closed=[];const warm=new CallPrewarm(v=>closed.push(v));let resolve;
 const pending=warm.start('a','s',()=>new Promise(r=>resolve=r));await Promise.resolve();warm.clear();resolve('old');assert.equal(await pending,null);assert.deepEqual(closed,['old']);
 await warm.start('b','s',async()=> 'ready');warm.clear();assert.deepEqual(closed,['old','ready']);
 assert.equal(await warm.start('c','s',async()=>{throw Error('offline')}),null);assert.equal(await warm.get('c','s'),null);
});
test('bundled call sounds match pinned official sources and include licenses',()=>{
 const rows=JSON.parse(readFileSync(new URL('../third-party/telegram-sounds/manifest.json',import.meta.url)));
 assert.equal(rows.filter(x=>x.target.endsWith('.mp3')).length,11);
 for(const row of rows){const bytes=readFileSync(new URL('../'+row.target,import.meta.url));assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);}
});
