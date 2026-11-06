import test from 'node:test';
import assert from 'node:assert/strict';
import {gatherRelayCandidates,relayGatherDecision} from '../client/src/call-gather.mjs';
const relay=n=>'v=0\r\n'+Array.from({length:n},(_,i)=>`a=candidate:${i} 1 udp 123 192.0.2.1 49160 typ relay\r\n`).join('');
test('ready relay does not wait for an alternate TURN route to finish',async()=>{
 let time=0;const pc={signalingState:'stable',iceGatheringState:'gathering',localDescription:{sdp:relay(0)}};
 const result=await gatherRelayCandidates(pc,{now:()=>time,sleep:async ms=>{time+=ms;if(time>=240)pc.localDescription.sdp=relay(2);}});
 assert.equal(result.gather_exit,'relay_ready');assert.equal(result.relay_count,2);assert.equal(time,440);assert.ok(!JSON.stringify(result).includes('192.0.2.1'));
});
test('additional candidates reset the short settling window; no relay retains the bounded timeout',async()=>{
 let time=0;const pc={signalingState:'stable',iceGatheringState:'gathering',localDescription:{sdp:relay(1)}};
 const result=await gatherRelayCandidates(pc,{now:()=>time,sleep:async ms=>{time+=ms;if(time>=160)pc.localDescription.sdp=relay(2);}});assert.equal(time,360);assert.equal(result.relay_count,2);
 time=0;pc.localDescription.sdp=relay(0);const absent=await gatherRelayCandidates(pc,{now:()=>time,sleep:async ms=>{time+=ms;}});assert.equal(absent.gather_exit,'timeout');assert.equal(time,10000);
});
test('complete gathering and closed peers do not keep timers or poll indefinitely',async()=>{
 const sleep=()=>{throw Error('Unexpected wait')};const pc={signalingState:'stable',iceGatheringState:'complete',localDescription:{sdp:relay(1)}};
 assert.equal((await gatherRelayCandidates(pc,{sleep})).gather_exit,'complete');pc.signalingState='closed';assert.equal((await gatherRelayCandidates(pc,{sleep})).gather_exit,'peer_closed');
 assert.equal(relayGatherDecision({complete:false,relays:0,quietMs:999,elapsedMs:999}),null);
});

test('stale COMPLETE without relays cannot send an empty prewarmed answer',async()=>{
 let time=0;const pc={signalingState:'stable',iceGatheringState:'complete',localDescription:{sdp:relay(0)}};
 const result=await gatherRelayCandidates(pc,{now:()=>time,sleep:async ms=>{time+=ms;if(time>=160)pc.iceGatheringState='gathering';if(time>=400)pc.localDescription.sdp=relay(2);}});
 assert.equal(result.relay_count,2);assert.equal(result.gather_exit,'relay_ready');assert.equal(time,600);
 assert.equal(relayGatherDecision({complete:true,relays:0,quietMs:0,elapsedMs:4}),null);
});
