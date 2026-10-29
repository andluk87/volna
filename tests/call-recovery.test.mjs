import test from 'node:test';
import assert from 'node:assert/strict';
import {callSafetyCode,callSafetyMaterial} from '../shared/call-safety.mjs';
import {CallRecovery} from '../client/src/call-recovery.mjs';
const id='a'.repeat(32),sdp=byte=>'v=0\r\na=fingerprint:sha-256 '+Array(32).fill(byte).join(':')+'\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
test('DTLS safety: same cross-platform code in both directions, binds call and both fingerprints, rejects ambiguous or missing keys',async()=>{
 const code=await callSafetyCode(id,sdp('AA'),sdp('BB'));assert.match(code,/^[A-F0-9]{4}( · [A-F0-9]{4}){3}$/);assert.equal(await callSafetyCode(id,sdp('BB'),sdp('AA')),code);
 assert.notEqual(await callSafetyCode('b'.repeat(32),sdp('AA'),sdp('BB')),code);assert.notEqual(await callSafetyCode(id,sdp('AC'),sdp('BB')),code);
 assert.equal(await callSafetyCode(id,sdp('AA'),''),'');assert.equal(callSafetyMaterial(id,sdp('AA')+sdp('BB'),sdp('AA')),null);
 assert.equal(await callSafetyCode(id,sdp('aa'),sdp('bb')),code);assert.equal(code,'741D · 4E0E · 0821 · 471C');
});
function harness(incoming=false){
 let call={id,status:'active',media_reporting:true,incoming,restart_generation:0,reconnecting:false},alive=true,offers=0,answers=0,fail=false;const sent=[];
 const description=(type,byte)=>({type,sdp:sdp(byte),toJSON(){return {type,sdp:this.sdp};}});
 const pc={connectionState:'connected',signalingState:'stable',localDescription:description(incoming?'answer':'offer','AA'),remoteDescription:description(incoming?'offer':'answer','BB'),createOffer:async()=>{offers++;return description('offer','CC');},createAnswer:async()=>{answers++;return description('answer','DD');},setLocalDescription:async d=>{pc.localDescription={...d,toJSON:()=>d};pc.signalingState=d.type==='offer'?'have-local-offer':'stable';},setRemoteDescription:async d=>{pc.remoteDescription=d;pc.signalingState=d.type==='offer'?'have-remote-offer':'stable';}};
 const recovery=new CallRecovery({pc,getCall:()=>call,request:async(path,data)=>{sent.push({path,data});if(path.endsWith('ice-restart')){if(data.description)call={...call,restart_generation:1,restart_requested:false,offer:data.description,answer:null};else call={...call,reconnecting:true,restart_requested:true};}if(path.endsWith('answer'))call={...call,answer:data.description};if(fail){fail=false;throw Error('response lost');}return call;},onCall:c=>{call=c;},onPhase:()=>{},onFailure:()=>{},onSafety:()=>{},isCurrent:()=>alive,device:id,gather:async()=>{}});
 return {pc,recovery,sent,get call(){return call;},setCall:c=>{call={...call,...c};},loseResponse:()=>{fail=true;},stop:()=>{alive=false;recovery.dispose();},offers:()=>offers,answers:()=>answers};
}
test('ICE recovery: caller retries lost restart response, applies answer once, reports current generation and disposes',async t=>{
 const h=harness();t.after(h.stop);await h.recovery.sync(h.call);assert.equal(h.sent.at(-1).data.restart_generation,0);
 h.loseResponse();await h.recovery.disconnected();assert.equal(h.call.restart_requested,true);await h.recovery.sync(h.call);assert.equal(h.offers(),1);assert.equal(h.call.restart_generation,1);
 h.setCall({answer:{type:'answer',sdp:sdp('DD')}});await h.recovery.sync(h.call);assert.equal(h.recovery.generation,1);assert.equal(h.sent.at(-1).data.restart_generation,1);assert.equal(h.offers(),1);
 const n=h.sent.length;h.stop();await h.recovery.sync(h.call);await h.recovery.disconnected();assert.equal(h.sent.length,n);
});
test('ICE recovery: callee retries exact answer after lost HTTP response without recreating SDP',async t=>{
 const h=harness(true);t.after(h.stop);h.setCall({restart_generation:1,reconnecting:true,offer:{type:'offer',sdp:sdp('CC')}});h.loseResponse();await assert.rejects(h.recovery.sync(h.call),/response lost/);assert.equal(h.answers(),1);
 await h.recovery.sync(h.call);assert.equal(h.answers(),1);assert.equal(h.recovery.generation,1);const sent=h.sent.filter(x=>x.path.endsWith('/answer'));assert.equal(sent.length,2);assert.deepEqual(sent[0].data,sent[1].data);
});
test('ICE recovery: simultaneous poll and connection callbacks perform one negotiation',async t=>{
 const h=harness();t.after(h.stop);h.setCall({restart_requested:true,reconnecting:true});await Promise.all([h.recovery.sync(h.call),h.recovery.sync(h.call),h.recovery.sync(h.call)]);assert.equal(h.offers(),1);
});

test('call commands retry network/5xx failures once with the identical key, never retry rejection or cancellation',async()=>{
 const {retryCallMutation}=await import('../client/src/call-request.mjs');const body={client_id:id};let attempts=[];
 const transport=async(...args)=>{attempts.push(args);if(attempts.length===1)throw new TypeError('network down');return {id};};
 assert.deepEqual(await retryCallMutation(transport,'/calls/start','token',body),{id});assert.equal(attempts.length,2);assert.equal(attempts[0][2],attempts[1][2]);
 for(const error of [Object.assign(Error('rejected'),{status:409}),Object.assign(Error('cancelled'),{name:'AbortError'})]){let count=0;await assert.rejects(retryCallMutation(async()=>{count++;throw error;},'/calls/start','token',body));assert.equal(count,1);}
 let count=0;await assert.rejects(retryCallMutation(async()=>{count++;throw Error('down');},'/profile','token',body));assert.equal(count,1);
});
