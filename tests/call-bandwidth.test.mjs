import test from 'node:test';
import assert from 'node:assert/strict';
import {economicalAudioDescription,limitCallSenders} from '../client/src/call-bandwidth.mjs';
import {presenceLabel} from '../client/src/presence.mjs';
test('economical audio caps Opus, preserves unrelated codecs and video, and is idempotent',()=>{
 const video='m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
 const original={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;stereo=1\r\na=rtpmap:0 PCMU/8000\r\na=ptime:20\r\n'+video};
 const changed=economicalAudioDescription(original);assert.equal(changed.type,'offer');assert.ok(changed.sdp.endsWith(video));assert.match(changed.sdp,/maxaveragebitrate=24000/);assert.match(changed.sdp,/usedtx=1/);assert.match(changed.sdp,/stereo=0/);assert.match(changed.sdp,/a=ptime:40/);assert.match(changed.sdp,/PCMU\/8000/);assert.equal(economicalAudioDescription(changed).sdp,changed.sdp);assert.match(original.sdp,/stereo=1/);
 assert.equal(economicalAudioDescription({sdp:'m=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n'}).sdp,'m=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n');
});
test('sender caps apply to voice and video encodings without changing track identity',async()=>{const updated=[];const senders=['audio','video'].map(kind=>({track:{kind},getParameters:()=>({encodings:[{rid:'main'}]}),setParameters:async p=>updated.push(p)}));await limitCallSenders({getSenders:()=>senders});assert.equal(updated[0].encodings[0].maxBitrate,24000);assert.equal(updated[1].encodings[0].maxBitrate,400000);assert.equal(updated[1].encodings[0].maxFramerate,15);assert.equal(updated[0].encodings[0].rid,'main');});
test('presence uses real timestamps and never invents a recent visit',()=>{assert.equal(presenceLabel(true,null),'в сети');assert.equal(presenceLabel(false,null),'Время посещения недоступно');assert.equal(presenceLabel(false,100000,230000),'был(а) 2 мин. назад');});
