export function callTone(call,connected=false){if(!call||connected)return '';if(call.incoming&&call.status==='ringing')return 'incoming';if(call.status==='ringing')return call.ring_received?'ringback':'setup';if(['preparing','connecting','active'].includes(call.status))return 'setup';return '';}
export function callEndTone(reason,hadCall=true){
 if(['other_device','call_replaced','session_reset','component_unmount','abandoned_call','operation_cancelled'].includes(reason))return '';
 if(['call_busy','server_declined'].includes(reason))return 'busy';
 if(['start_error','accept_error','answer_error','webrtc_unavailable','audio_error','audio_focus_lost','telecom_audio_lost','service_error','service_destroyed','uncaught_error','poll_timeout','connect_timeout','recovery_timeout','server_interrupted'].includes(reason))return 'failed';
 return hadCall?'end':'';
}
export class CallTones{
 constructor({createAudio=src=>new Audio(src),baseUrl=globalThis.document?.baseURI||'http://localhost/'}={}){this.createAudio=createAudio;this.baseUrl=baseUrl;this.audio=null;this.kind='';}
 unlock(){try{this.audio?.play()?.catch(()=>{});}catch{}}
 set(kind){if(kind===this.kind)return;this.stop();if(!kind)return;const files={incoming:'call_incoming.mp3',ringback:'call_outgoing.mp3',setup:'call_connect.mp3',end:'call_end.mp3',busy:'call_busy.mp3',failed:'call_failed.mp3'};if(!files[kind])return;
  try{const audio=this.createAudio(new URL('sounds/'+files[kind],this.baseUrl).href);this.audio=audio;this.kind=kind;audio.loop=['incoming','ringback','setup'].includes(kind);audio.volume=.45;audio.preload='auto';audio.onended=()=>{if(this.audio===audio){this.audio=null;this.kind='';}};audio.play()?.catch(()=>{});}catch{this.stop();}
 }
 play(kind){this.set(kind);}
 stop(){const audio=this.audio;this.audio=null;this.kind='';if(audio){audio.onended=null;try{audio.pause();audio.currentTime=0;}catch{}}}
 close(){this.stop();}
}
