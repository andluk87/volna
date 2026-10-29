import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const vite=await createServer({root:new URL('../client/',import.meta.url).pathname,server:{host:'127.0.0.1',port:5195,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-features=WebRtcHideLocalIpsWithMdns','--allow-loopback-in-peer-connection']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5195/');
 const result=await page.evaluate(async(sharedPath)=>{
  const {CallRecovery}=await import('/src/call-recovery.mjs');const {callSafetyCode}=await import('/@fs'+sharedPath);
  const a=new RTCPeerConnection(),b=new RTCPeerConnection(),ctx=new AudioContext(),dst=ctx.createMediaStreamDestination(),tone=ctx.createOscillator();tone.connect(dst);tone.start();await ctx.resume();
  const track=dst.stream.getAudioTracks()[0];a.addTrack(track,dst.stream);b.addTrack(track,dst.stream);
  const gather=pc=>new Promise(resolve=>{const timer=setTimeout(done,6000);function done(){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}function check(){if(pc.iceGatheringState==='complete')done();}pc.addEventListener('icegatheringstatechange',check);check();});
  let left,right,epoch=0,requested=false,reconnecting=false,offer,answer,reported=new Set(),codes=[];
  const id='a'.repeat(32),snapshot=incoming=>({id,incoming,status:'active',media_reporting:true,restart_generation:epoch,restart_requested:requested,reconnecting,offer:incoming?offer:undefined,answer:incoming?undefined:answer});
  const make=(pc,incoming)=>new CallRecovery({pc,getCall:()=>incoming?right:left,request:async(path,data)=>{if(path.endsWith('/ice-restart')){reconnecting=true;if(data.description){offer=data.description;epoch++;answer=null;requested=false;reported.clear();}else requested=true;}if(path.endsWith('/answer'))answer=data.description;if(path.endsWith('/media-state')){reported.add(incoming);if(reported.size===2)reconnecting=false;}left=snapshot(false);right=snapshot(true);return incoming?right:left;},onCall:c=>{if(incoming)right=c;else left=c;},onPhase:()=>{},onFailure:e=>{throw Error(e);},onSafety:code=>codes.push(code),isCurrent:()=>true,device:id,gather});
  const ra=make(a,false),rb=make(b,true);const wait=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>12000)throw Error('connection timeout');await new Promise(r=>setTimeout(r,50));}};
  try{
   await a.setLocalDescription(await a.createOffer());await gather(a);await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await gather(b);await a.setRemoteDescription(b.localDescription);
   if(!a.localDescription.sdp.includes('a=candidate:')&&!b.localDescription.sdp.includes('a=candidate:'))return {unavailable:true};
   await wait(()=>a.connectionState==='connected'&&b.connectionState==='connected');offer=a.localDescription.toJSON();answer=b.localDescription.toJSON();left=snapshot(false);right=snapshot(true);
   const before=a.localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1];await rb.disconnected();await ra.sync(left);await rb.sync(right);await ra.sync(left);await wait(()=>a.connectionState==='connected'&&b.connectionState==='connected');await rb.sync(right);await ra.sync(left);await rb.sync(right);
   const after=a.localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1],codeA=await callSafetyCode(id,a.localDescription.sdp,a.remoteDescription.sdp),codeB=await callSafetyCode(id,b.localDescription.sdp,b.remoteDescription.sdp);
   const packets=async()=>[...await b.getStats()].filter(x=>x.type==='inbound-rtp'&&x.kind==='audio').reduce((sum,x)=>sum+(x.packetsReceived||0),0);const first=await packets();await new Promise(r=>setTimeout(r,500));return {epoch,before,after,codeA,codeB,received:await packets()-first,reconnecting};
  }finally{ra.dispose();rb.dispose();a.close();b.close();track.stop();tone.stop();await ctx.close();}
 },new URL('../shared/call-safety.mjs',import.meta.url).pathname);
 if(result.unavailable)console.log('SKIP real ICE restart: cloud Chromium exposes no ICE candidates. Device/network acceptance remains required.');
 else{assert.equal(result.epoch,1);assert.notEqual(result.before,result.after);assert.equal(result.codeA,result.codeB);assert.ok(result.codeA);assert.ok(result.received>0);assert.equal(result.reconnecting,false);console.log('PASS real two-peer ICE restart: same call, new ICE credentials, matching safety code, audio packets received');}
}finally{await browser.close();await vite.close();}
