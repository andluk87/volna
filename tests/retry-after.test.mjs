import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs} from '../shared/retry-after.mjs';
import {callNetworkRetry} from '../client/src/call-network-retry.mjs';
test('Retry-After uses server-relative time, accepts seconds/dates and bounds malformed delays',()=>{
 assert.equal(retryAfterMs({retry_at:160000,server_time:100000},999999999),60000);assert.equal(retryAfterMs({header:'12'}),12000);assert.equal(retryAfterMs({header:'0'}),1000);assert.equal(retryAfterMs({header:new Date(20000).toUTCString()},0),20000);assert.equal(retryAfterMs({header:'bad'}),60000);assert.equal(retryAfterMs({header:'9999999'}),300000);
});
test('429 pauses and respects a shared deadline without starting a late mutation',async()=>{
 let now=0,calls=0;const sleeps=[];assert.equal(await callNetworkRetry(async()=>{if(++calls===1)throw Object.assign(Error('limited'),{status:429,retryAfterMs:60000});return 'ok';},{now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}}),'ok');assert.deepEqual(sleeps,[60000]);
 now=0;calls=0;await assert.rejects(callNetworkRetry(async()=>{calls++;throw Object.assign(Error('limited'),{status:429,retryAfterMs:300000});},{now:()=>now,sleep:async ms=>{now+=ms;}}),{status:429});assert.equal(now,180000);assert.equal(calls,1);
});
