import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import alphabet from '../shared/call-safety-emoji.json' with {type:'json'};
import {callSafetyEmojis} from '../shared/call-safety-emojis.mjs';
import {callNetworkRetry} from '../client/src/call-network-retry.mjs';
test('four key emojis match Android alphabet and use both halves of the safety code',async()=>{
 assert.equal(alphabet.length,256);assert.equal(new Set(alphabet).size,256);
 const native=await readFile(new URL('../android-native/app/src/main/java/dev/volna/messenger/NativeCallSafetyEmojis.kt',import.meta.url),'utf8');assert.deepEqual(JSON.parse('['+native.match(/listOf\((.*)\)/)[1]+']'),alphabet);
 const code='741D · 4E0E · 0821 · 471C',expected=[0x74^8,0x1d^0x21,0x4e^0x47,0xe^0x1c].map(i=>alphabet[i]).join(' ');assert.equal(callSafetyEmojis(code),expected);assert.equal(expected.split(' ').length,4);assert.notEqual(callSafetyEmojis('751D4E0E0821471C'),expected);assert.equal(callSafetyEmojis(''), '');
});
test('network retry survives transport outages, stops on cancellation, ownership errors and deadline',async()=>{
 let clock=0,attempts=0,waits=0;const options={now:()=>clock,sleep:async ms=>{clock+=ms;},waiting:()=>waits++};
 assert.equal(await callNetworkRetry(async()=>{if(++attempts<4)throw new TypeError('offline');return 'connected';},options),'connected');assert.equal(waits,3);
 attempts=0;await assert.rejects(callNetworkRetry(async()=>{attempts++;throw Object.assign(Error('elsewhere'),{status:409});},options),{status:409});assert.equal(attempts,1);
 await assert.rejects(callNetworkRetry(async()=>{throw Error('must not run');},{valid:()=>false}),{name:'AbortError'});
 clock=0;await assert.rejects(callNetworkRetry(async()=>{throw Error('offline');},{...options,timeout:2000}),/offline/);assert.equal(clock,2000);
});
