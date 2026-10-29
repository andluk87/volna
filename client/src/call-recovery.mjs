import {economicalAudioDescription} from './call-bandwidth.mjs';
import {callSafetyCode} from '../../shared/call-safety.mjs';
export class CallRecovery {
 constructor({pc,getCall,request,onCall,onPhase,onFailure,onSafety,isCurrent,device,gather,timeout=20000}){Object.assign(this,{pc,getCall,request,onCall,onPhase,onFailure,onSafety,isCurrent,device,gather,timeout});this.generation=0;this.busy=false;this.deadline=null;this.reported=-1;this.pending=null;this.closed=false;this.needsRestart=false;this.pendingAnswer=null;}
 valid(){return !this.closed&&this.isCurrent();}
 dispose(){this.closed=true;clearTimeout(this.deadline);this.deadline=null;}
 async safety(){if(!this.valid())return;const c=this.getCall();const code=await callSafetyCode(c?.id,this.pc.localDescription?.sdp,this.pc.remoteDescription?.sdp);if(this.valid())this.onSafety(code);}
 async send(op,data={}){const c=this.getCall();if(!c||!this.valid())return null;const result=await this.request(`/calls/${c.id}/${op}`,{device:this.device,...data});if(this.valid()&&result?.id===c.id)this.onCall(result);return result;}
 async disconnected(){
  if(!this.valid())return;
  const c=this.getCall();this.reported=-1;this.needsRestart=true;this.onPhase('Восстанавливаем соединение…');
  if(!this.deadline)this.deadline=setTimeout(()=>{if(this.valid())this.onFailure('Звонок прерван: не удалось восстановить соединение');},this.timeout);
  if(!c?.media_reporting)return;
  try{await this.send('ice-restart');await this.sync(this.getCall());}catch{/* Polling retries while the bounded recovery timer runs. */}
 }
 async sync(c){
  if(!this.valid()||this.busy||!c?.media_reporting||c.status!=='active')return;
  this.busy=true;
  try{
   const epoch=c.restart_generation||0;
   if(this.needsRestart&&!c.reconnecting){await this.send('ice-restart');this.needsRestart=false;return;}
   if(c.reconnecting)this.needsRestart=false;
   if(c.restart_requested&&!c.incoming&&!this.pending&&this.pc.signalingState==='stable'){
    const offer=economicalAudioDescription(await this.pc.createOffer({iceRestart:true}));if(!this.valid())return;
    await this.pc.setLocalDescription(offer);await this.gather(this.pc);if(!this.valid())return;
    this.pending={description:this.pc.localDescription.toJSON(),restart_generation:epoch};
   }
   if(this.pending){
    if(epoch===this.pending.restart_generation){await this.send('ice-restart',this.pending);return;}
    this.pending=null;
   }
   if(epoch>this.generation){
    if(c.incoming&&c.offer){if(this.pendingAnswer?.restart_generation!==epoch){await this.pc.setRemoteDescription(c.offer);await this.pc.setLocalDescription(economicalAudioDescription(await this.pc.createAnswer()));await this.gather(this.pc);if(!this.valid())return;this.pendingAnswer={description:this.pc.localDescription.toJSON(),restart_generation:epoch};}await this.send('answer',this.pendingAnswer);if(!this.valid())return;this.generation=epoch;this.pendingAnswer=null;}
    else if(!c.incoming&&c.answer){await this.pc.setRemoteDescription(c.answer);this.generation=epoch;}
    else return;
   }
   if(this.valid()&&this.pc.connectionState==='connected'&&this.reported!==epoch){await this.send('media-state',{connected:true,restart_generation:epoch});if(this.valid())this.reported=epoch;}
   if(this.valid()&&!this.getCall()?.reconnecting&&this.pc.connectionState==='connected'){clearTimeout(this.deadline);this.deadline=null;}
   await this.safety();
  }finally{this.busy=false;}
 }
}
