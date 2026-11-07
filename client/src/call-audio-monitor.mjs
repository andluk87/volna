/** RTP silence is diagnostic evidence, never proof of failure (mute/DTX are valid). */
export class CallAudioMonitor{
 constructor(started,{stallMs=20000}={}){this.started=started;this.stallMs=stallMs;this.previous=null;this.progress=started;this.seen=false;this.stalled=false;}
 observe(packets,now){
  if(!Number.isFinite(packets)||packets<0)return null;
  const before=this.previous;this.previous=packets;
  if(packets>0&&!this.seen){this.seen=true;this.progress=now;return {lifecycle:'audio_first_packet',elapsed_ms:Math.max(0,now-this.started)};}
  if(before!==null&&packets<before){this.progress=now;return null;}
  if(before===null||packets!==before){this.progress=now;if(this.stalled){this.stalled=false;return {lifecycle:'audio_resumed'};}return null;}
  if(this.seen&&!this.stalled&&now-this.progress>=this.stallMs){this.stalled=true;return {lifecycle:'audio_stalled',elapsed_ms:now-this.progress};}
  return null;
 }
}
