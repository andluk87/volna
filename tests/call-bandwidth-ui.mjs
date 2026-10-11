import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const vite=await createServer({root:new URL('../client/',import.meta.url).pathname,server:{host:'127.0.0.1',port:5193,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-features=WebRtcHideLocalIpsWithMdns','--allow-loopback-in-peer-connection','--force-webrtc-ip-handling-policy=default']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5193/');
 const result=await page.evaluate(async()=>{
  const {economicalAudioDescription,limitCallSenders}=await import('/src/call-bandwidth.mjs');const a=new RTCPeerConnection(),b=new RTCPeerConnection(),audio=new AudioContext(),dest=audio.createMediaStreamDestination();
  const size=audio.sampleRate*2,buffer=audio.createBuffer(1,size,audio.sampleRate),data=buffer.getChannelData(0);let seed=7;for(let i=0;i<size;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=(seed/4294967296-.5)*.2;}const source=audio.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(dest);source.start();await audio.resume();
  const gathered=pc=>new Promise(resolve=>{if(pc.iceGatheringState==='complete')return resolve();pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')resolve();};});const track=dest.stream.getAudioTracks()[0];a.addTrack(track,dest.stream);
  try{
   await a.setLocalDescription(economicalAudioDescription(await a.createOffer()));await gathered(a);await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(economicalAudioDescription(await b.createAnswer()));await gathered(b);await a.setRemoteDescription(b.localDescription);await limitCallSenders(a);if(!a.localDescription.sdp.includes('a=candidate:')&&!b.localDescription.sdp.includes('a=candidate:'))return {unavailable:true};
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('WebRTC connection timeout: '+JSON.stringify({a:a.connectionState,b:b.connectionState,ice:a.iceConnectionState,candidates:(a.localDescription.sdp.match(/^a=candidate:/mg)||[]).length}))),10000);const check=()=>{if(a.connectionState==='connected'){clearTimeout(timeout);resolve();}};a.onconnectionstatechange=check;check();});
   const sample=async()=>[...await a.getStats()].find(r=>r.type==='outbound-rtp'&&r.kind==='audio');const first=await sample();await new Promise(r=>setTimeout(r,4000));const last=await sample(),stats=await a.getStats(),codec=stats.get(last.codecId);return {codec:codec.mimeType,bytesPerSecond:(last.bytesSent-first.bytesSent)/((last.timestamp-first.timestamp)/1000),packets:last.packetsSent-first.packetsSent};
  }finally{a.close();b.close();track.stop();source.stop();await audio.close();}
 });if(result.unavailable){console.log('SKIP transport measurement: cloud Chromium exposes no ICE candidates; no throughput claim');}else{assert.equal(result.codec,'audio/opus');assert.ok(result.packets>0);assert.ok(result.bytesPerSecond<6000,'economical Opus payload remains below 6 KB/s on a local noise call');console.log('PASS: real two-peer Opus exchange (RTP payload only)',JSON.stringify(result));}
}finally{await browser.close();await vite.close();}
