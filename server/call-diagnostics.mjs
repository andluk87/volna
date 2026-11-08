import {callEndReasons,callLifecycleActions} from '../shared/call-debug.mjs';
const events=new Set(['client.lifecycle','client.stage','client.error','rtc.state','rtc.candidate','rtc.ice_error','rtc.stats','rtc.gathered','client.ended']);
const enums={transport_stage:['authorization','dns','connect','tls','request','response_headers','response_body','auth_refresh'],gather_exit:['complete','relay_ready','timeout','peer_closed'],bundle_policy:['max-bundle','balanced','max-compat'],trigger:['messaging_stop','messaging_sync','messaging_login','no_accounts','session_invalid','account_logout','main_activity','call_activity'],network_transport:['none','wifi','cellular','ethernet','vpn','other'],end_reason:callEndReasons,lifecycle:callLifecycleActions,call_status:['preparing','ringing','connecting','active','other-device','none'],delivery_error_type:['NativeApiException','NativeCallTransportException','IOException','InterruptedIOException','SocketTimeoutException','UnknownHostException','ConnectException','SSLHandshakeException','SocketException','TimeoutError','TypeError','AbortError','Error'],audio_focus:['gained','lost','transient'],connection:['new','connecting','connected','disconnected','failed','closed'],ice:['new','checking','connected','completed','failed','disconnected','closed'],gathering:['new','gathering','complete'],signaling:['stable','have-local-offer','have-remote-offer','have-local-pranswer','have-remote-pranswer','closed'],candidate_type:['host','srflx','prflx','relay'],protocol:['udp','tcp'],error_type:['Error','TypeError','AbortError','NotAllowedError','NotFoundError','NotReadableError','OperationError','SecurityError','TimeoutError','IllegalStateException','SecurityException','NativeApiException','NativeCallTransportException','IOException','InterruptedIOException','SocketTimeoutException','UnknownHostException','ConnectException','SSLHandshakeException','SocketException','LinkageError'],stage:['start','accept','turn_config','microphone','peer_create','offer','answer','gather','restart','audio_device','remote_track','poll','cleanup']};
const numbers=['candidate_pool_size','relay_count','host_count','srflx_count','prflx_count','udp_count','tcp_count','audio_packets_received','audio_packets_sent','bytes_sent','bytes_received','packets_sent','packets_received','packets_lost','rtt_ms','ice_error','http_status','restart_generation','elapsed_ms','delivery_http_status','sequence','uptime_ms','generation','sdk','poll_age_ms','call_version'];
export function diagnosticFields(data){
 const out={};for(const [key,values]of Object.entries(enums))if(values.includes(data[key]))out[key]=data[key];
 for(const key of numbers)if(typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=-1&&data[key]<=Number.MAX_SAFE_INTEGER)out[key]=data[key];
 for(const key of ['connected','audio_track','video_track','turn_configured','turn_tls','notify_server','has_peer','operation_active','session_same','session_blank','incoming','telecom_audio','focused','visible','network_validated','network_metered'])if(typeof data[key]==='boolean')out[key]=data[key];
 if(typeof data.client_version==='string'&&/^[a-zA-Z0-9._+-]{1,40}$/.test(data.client_version))out.client_version=data.client_version;
 if(Number.isSafeInteger(data.client_time)&&data.client_time>0)out.client_time=data.client_time;
 if(typeof data.process_id==='string'&&/^[a-f0-9]{32}$/.test(data.process_id))out.process_id=data.process_id;
 for(const key of ['model','manufacturer'])if(typeof data[key]==='string'&&/^[a-zA-Z0-9 ._+-]{1,64}$/.test(data[key]))out[key]=data[key];
 return out;
}
export function callDiagnostics({db,body,json,auth,log,clock,device}){
 const rates=new Map(),seen=new Map(),warnings=new Map();
 const fail=(status,message)=>Object.assign(Error(message),{status});
 function rejected(uid,status){const key=uid+':'+status,now=clock();for(const [k,at]of warnings)if(now-at>60000)warnings.delete(k);if(!warnings.has(key)){warnings.set(key,now);log('call.diagnostics_rejected',{user_id:uid,http_status:status,reason:'diagnostics_delivery_failed'});}}
 function accept(data,uid,source){
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Некорректный отчёт');
  const d=device(data.device);
  if(!events.has(data.event)||!['web','windows','android'].includes(data.platform))throw fail(400,'Некорректное событие диагностики');
  if(data.report_id!==undefined&&(typeof data.report_id!=='string'||!/^[a-f0-9]{32}$/.test(data.report_id)))throw fail(400,'Некорректный отчёт');
  const now=clock(),key=uid+':'+d,reportKey=data.report_id?key+':'+data.report_id:null;
  for(const [k,at]of seen)if(now-at>600000)seen.delete(k);
  let row;if(data.call_id!==undefined&&data.call_id!==null){if(typeof data.call_id!=='string'||!/^[a-f0-9]{32}$/.test(data.call_id))throw fail(400,'Некорректный звонок');row=db.prepare('SELECT * FROM call_history WHERE id=? AND (caller=? OR callee=?)').get(data.call_id,uid,uid);if(!row)throw fail(404,'Звонок недоступен');if(row.ended&&now-row.ended>10*60000)throw fail(410,'Диагностика звонка завершена');}
  else if(!['client.stage','client.error','client.lifecycle'].includes(data.event))throw fail(400,'Укажите звонок');
  if(reportKey&&seen.has(reportKey))return {ok:true,duplicate:true};
  for(const [k,r]of rates)if(now-r.start>=60000)rates.delete(k);const rate=rates.get(key)||{start:now,count:0};rates.set(key,rate);if(++rate.count>120)throw fail(429,'Слишком много событий диагностики');
  const logged=log(data.event,{...diagnosticFields(data),call_id:row?.id,chat_id:row?.chat_id,user_id:uid,role:row?(row.caller===uid?'caller':'callee'):undefined,device:d,platform:data.platform,source,report_id:data.report_id});
  if(logged===false)throw fail(503,'Журнал диагностики временно недоступен');
  if(reportKey){seen.set(reportKey,now);if(seen.size>10000)seen.delete(seen.keys().next().value);}return {ok:true};
 }
 const handle=async(req,res,url,uid)=>{
  if(url.pathname!=='/api/calls/diagnostics')return false;
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
  try{const data=await body(req);auth(req);json(res,200,accept(data,uid,'post'));return true;}catch(error){rejected(uid,error.status||500);throw error;}
 };
 handle.fromHeader=(req,uid)=>{if(req.url?.split('?')[0]==='/api/calls/diagnostics')return;const header=req.headers?.['x-volna-call-diagnostics'];if(header===undefined)return;try{if(typeof header!=='string'||header.length>4096||!/^[a-zA-Z0-9_-]+={0,2}$/.test(header))throw fail(400,'Некорректный заголовок');const data=JSON.parse(Buffer.from(header,'base64url').toString('utf8'));accept(data,uid,'call_request');}catch(error){rejected(uid,error.status||400);}};
 return handle;
}
