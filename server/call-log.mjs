import {mkdirSync,appendFileSync,readFileSync,statSync,existsSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,truncateSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
export const CALL_LOG_BYTES=1024*1024;
const fields=new Set(('trigger network_transport network_validated network_metered end_reason lifecycle call_status sequence uptime_ms generation sdk poll_age_ms call_version notify_server has_peer operation_active session_same session_blank incoming telecom_audio focused visible process_id model manufacturer source report_id delivery_http_status delivery_error_type call_id chat_id user_id caller callee caller_device callee_device role device platform client_version operation status reason version restart_generation age_ms accepted_ms connected caller_connected callee_connected caller_seen_ms callee_seen_ms connection audio_focus ice gathering signaling relay_count caller_relay_count callee_relay_count host_count srflx_count prflx_count udp_count tcp_count bytes_sent bytes_received packets_sent packets_received packets_lost rtt_ms ice_error http_status error_type stage turn_configured turn_tls media_reporting video candidate_type protocol audio_track video_track client_time elapsed_ms stream_count subscription_count sessions interrupted_calls').split(' '));
// A single regular USTAR entry. No shell, tar executable or optional package is needed at runtime.
export function callLogTar(bytes,name='volna-calls.log',time=Date.now()){
 const header=Buffer.alloc(512);const str=(value,start,length)=>header.write(String(value),start,length,'ascii');const oct=(value,start,length)=>str(Math.floor(value).toString(8).padStart(length-1,'0')+'\0',start,length);
 str(name,0,100);oct(0o600,100,8);oct(0,108,8);oct(0,116,8);oct(bytes.length,124,12);oct(time/1000,136,12);header.fill(32,148,156);str('0',156,1);str('ustar\0',257,6);str('00',263,2);oct(header.reduce((a,b)=>a+b,0),148,7);header[155]=32;
 return Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512+1024)]);
}
export function createCallLog({directory,maxBytes=CALL_LOG_BYTES,clock=Date.now,onError=()=>console.error('[calls-log] Cannot write call log; check free space and directory permissions')}={}){
 if(!directory)return {write:()=>false,close:()=>{},file:null};
 if(!Number.isSafeInteger(maxBytes)||maxBytes<256)throw Error('Invalid call log limit');
 const file=join(directory,'volna-calls.log');let size=null,sequence=0,lastError=-Infinity,closed=false;
 function init(){if(size!==null)return;mkdirSync(directory,{recursive:true,mode:0o700});appendFileSync(file,'',{mode:0o600});size=statSync(file).size;if(size&&readFileSync(file).at(-1)!==10){appendFileSync(file,'\n');size++;}}
 function rotate(){
  const content=readFileSync(file);if(!content.length)return;
  const stamp=new Date(clock()).toISOString().replace('T','_').replace(/:/g,'-');let archive;
  do{archive=join(directory,`volna-calls_${stamp}_pid${process.pid}_${String(++sequence).padStart(6,'0')}.log.tar.gz`);}while(existsSync(archive));
  const temporary=archive+'.partial';let fd;
  try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,gzipSync(callLogTar(content,'volna-calls.log',clock())));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,archive);truncateSync(file,0);size=0;}
  catch(error){if(fd!==undefined)try{closeSync(fd);}catch{}try{unlinkSync(temporary);}catch{}throw error;}
 }
 function write(event,data={}){
  if(closed)return false;
  try{
   const row={time:new Date(clock()).toISOString(),event:/^[a-z][a-z0-9_.-]{0,63}$/.test(event)?event:'log.invalid_event'};
   for(const [key,value] of Object.entries(data))if(fields.has(key)&&value!==null&&value!==undefined){if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))row[key]=value;else if(typeof value==='string')row[key]=value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,160);}
   let line=Buffer.from(JSON.stringify(row)+'\n');if(line.length>16384)line=Buffer.from(JSON.stringify({time:row.time,event:row.event,reason:'record_too_large'})+'\n');
   init();if(size&&(size>=maxBytes||size+line.length>maxBytes))rotate();appendFileSync(file,line,{mode:0o600});size+=line.length;if(size>=maxBytes)rotate();return true;
  }catch{size=null;if(clock()-lastError>=30000){lastError=clock();try{onError();}catch{}}return false;}
 }
 return {write,close:()=>{closed=true;},file};
}
