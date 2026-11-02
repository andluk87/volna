const events=new Set(['client.stage','client.error','rtc.state','rtc.candidate','rtc.ice_error','rtc.stats','rtc.gathered','client.ended']);
const enums={audio_focus:['gained','lost','transient'],connection:['new','connecting','connected','disconnected','failed','closed'],ice:['new','checking','connected','completed','failed','disconnected','closed'],gathering:['new','gathering','complete'],signaling:['stable','have-local-offer','have-remote-offer','have-local-pranswer','have-remote-pranswer','closed'],candidate_type:['host','srflx','prflx','relay'],protocol:['udp','tcp'],error_type:['Error','TypeError','AbortError','NotAllowedError','NotFoundError','NotReadableError','OperationError','SecurityError','TimeoutError','IllegalStateException','SecurityException','NativeApiException','IOException','SocketTimeoutException','UnknownHostException','ConnectException','SSLHandshakeException','SocketException','LinkageError'],stage:['start','accept','turn_config','microphone','peer_create','offer','answer','gather','restart','audio_device','remote_track','poll','cleanup']};
const numbers=['relay_count','host_count','srflx_count','prflx_count','udp_count','tcp_count','bytes_sent','bytes_received','packets_sent','packets_received','packets_lost','rtt_ms','ice_error','http_status','restart_generation','elapsed_ms'];
export function diagnosticFields(data){
 const out={};for(const [key,values]of Object.entries(enums))if(values.includes(data[key]))out[key]=data[key];
 for(const key of numbers)if(typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=-1&&data[key]<=Number.MAX_SAFE_INTEGER)out[key]=data[key];
 for(const key of ['connected','audio_track','video_track','turn_configured','turn_tls'])if(typeof data[key]==='boolean')out[key]=data[key];
 if(typeof data.client_version==='string'&&/^[a-zA-Z0-9._+-]{1,40}$/.test(data.client_version))out.client_version=data.client_version;
 if(Number.isSafeInteger(data.client_time)&&data.client_time>0)out.client_time=data.client_time;
 return out;
}
export function callDiagnostics({db,body,json,auth,log,clock,device}){
 const rates=new Map();
 return async(req,res,url,uid)=>{
  if(url.pathname!=='/api/calls/diagnostics')return false;
  if(req.method!=='POST')throw Object.assign(Error('Метод не поддерживается'),{status:405});
  const data=await body(req);auth(req);const d=device(data.device);
  if(!events.has(data.event)||!['web','windows','android'].includes(data.platform))throw Object.assign(Error('Некорректное событие диагностики'),{status:400});
  let row;if(data.call_id!==undefined&&data.call_id!==null){if(typeof data.call_id!=='string'||!/^[a-f0-9]{32}$/.test(data.call_id))throw Object.assign(Error('Некорректный звонок'),{status:400});row=db.prepare('SELECT * FROM call_history WHERE id=? AND (caller=? OR callee=?)').get(data.call_id,uid,uid);if(!row)throw Object.assign(Error('Звонок недоступен'),{status:404});if(row.ended&&clock()-row.ended>10*60000)throw Object.assign(Error('Диагностика звонка завершена'),{status:410});}
  else if(!['client.stage','client.error'].includes(data.event))throw Object.assign(Error('Укажите звонок'),{status:400});
  const key=uid+':'+d,now=clock();for(const [k,r]of rates)if(now-r.start>=60000)rates.delete(k);const rate=rates.get(key)||{start:now,count:0};rates.set(key,rate);if(++rate.count>120)throw Object.assign(Error('Слишком много событий диагностики'),{status:429});
  log(data.event,{...diagnosticFields(data),call_id:row?.id,chat_id:row?.chat_id,user_id:uid,role:row?(row.caller===uid?'caller':'callee'):undefined,device:d,platform:data.platform});json(res,200,{ok:true});return true;
 };
}
