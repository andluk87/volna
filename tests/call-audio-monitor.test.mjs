import test from 'node:test';
import assert from 'node:assert/strict';
import {CallAudioMonitor} from '../client/src/call-audio-monitor.mjs';
import {callStats} from '../client/src/call-stats.mjs';
import {diagnosticFields} from '../server/call-diagnostics.mjs';
test('audio evidence distinguishes initial absence, first RTP, one stall and resumed packets',()=>{
 const monitor=new CallAudioMonitor(0);assert.equal(monitor.observe(undefined,0),null);assert.equal(monitor.observe(0,30000),null);
 assert.deepEqual(monitor.observe(5,31000),{lifecycle:'audio_first_packet',elapsed_ms:31000});assert.equal(monitor.observe(5,50000),null);assert.deepEqual(monitor.observe(5,51000),{lifecycle:'audio_stalled',elapsed_ms:20000});assert.equal(monitor.observe(5,60000),null);assert.equal(monitor.observe(0,61000),null,'counter reset alone is not resumed audio');assert.deepEqual(monitor.observe(1,62000),{lifecycle:'audio_resumed'});
});
test('video RTP cannot mask missing audio; diagnostic fields never include raw stats or addresses',()=>{
 const report=new Map([['a',{type:'inbound-rtp',kind:'audio',packetsReceived:3}],['v',{type:'inbound-rtp',kind:'video',packetsReceived:900}],['r',{type:'inbound-rtp',kind:'audio',isRemote:true,packetsReceived:999}]]);assert.equal(callStats(report).audio_packets_received,3);
 assert.deepEqual(diagnosticFields({lifecycle:'audio_stalled',audio_packets_received:3,sdp:'PRIVATE',address:'PRIVATE'}),{lifecycle:'audio_stalled',audio_packets_received:3});
});
