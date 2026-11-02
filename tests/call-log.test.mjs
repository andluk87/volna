import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CALL_LOG_BYTES,createCallLog} from '../server/call-log.mjs';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {callCandidateSummary,callStats} from '../client/src/call-stats.mjs';
const tmp=t=>{const dir=mkdtempSync(join(tmpdir(),'volna-call-log-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
test('call log rotates at 1 MiB, produces a real tar.gz, and continues without losing ordered records',t=>{
 const dir=tmp(t),log=createCallLog({directory:dir}),count=7500;assert.equal(CALL_LOG_BYTES,1048576);
 for(let i=0;i<count;i++)assert.equal(log.write('rtc.stats',{bytes_sent:i,call_id:'a'.repeat(32),reason:'record-'+i,token:'NEVER-LOG-TOKEN',sdp:'NEVER-LOG-SDP'}),true);
 const archives=readdirSync(dir).filter(n=>n.endsWith('.tar.gz')).sort();assert.ok(archives.length>=1);assert.ok(archives.every(n=>/^volna-calls_\d{4}-\d{2}-\d{2}_.*\.log\.tar\.gz$/.test(n)));assert.ok(statSync(log.file).size<CALL_LOG_BYTES);
 let lines=[];for(const name of archives){const path=join(dir,name),tar=gunzipSync(readFileSync(path));assert.equal(tar.subarray(257,263).toString(),'ustar\0');const listing=spawnSync('tar',['-tzf',path],{encoding:'utf8'});assert.equal(listing.status,0,listing.stderr);assert.equal(listing.stdout.trim(),'volna-calls.log');const output=spawnSync('tar',['-xOzf',path],{encoding:'utf8'});assert.equal(output.status,0,output.stderr);assert.ok(Buffer.byteLength(output.stdout)<=CALL_LOG_BYTES);assert.ok(!output.stdout.includes('NEVER-LOG'));lines.push(...output.stdout.trim().split('\n').map(JSON.parse));assert.equal(statSync(path).mode&0o777,0o600);}
 lines.push(...readFileSync(log.file,'utf8').trim().split('\n').map(JSON.parse));assert.equal(lines.length,count);assert.deepEqual(lines.map(r=>r.bytes_sent),Array.from({length:count},(_,i)=>i));assert.equal(statSync(log.file).mode&0o777,0o600);log.close();assert.equal(log.write('rtc.stats'),false);
});
test('rotation recovers after a restart and archive failure leaves the original file intact',t=>{
 const dir=tmp(t);const initial=createCallLog({directory:dir,maxBytes:700});for(let i=0;i<3;i++)initial.write('call.created',{version:i});initial.close();const before=readFileSync(initial.file);let errors=0;
 const restarted=createCallLog({directory:dir,maxBytes:256,onError:()=>errors++});assert.equal(restarted.write('call.created',{reason:'append'}),true);assert.ok(readFileSync(initial.file,'utf8').includes('append'));assert.ok(readdirSync(dir).some(p=>p.endsWith('.tar.gz')));restarted.close();
 const broken=join(dir,'not-a-directory');writeFileSync(broken,'keep this');const noLog=createCallLog({directory:broken,onError:()=>errors++});assert.equal(noLog.write('call.created'),false);assert.equal(noLog.write('call.created'),false);assert.equal(errors,1);assert.equal(readFileSync(broken,'utf8'),'keep this');noLog.close();assert.ok(before.length>0);
});
test('archive creation failure never truncates the active log',t=>{
 const dir=tmp(t);let now=Date.now(),errors=0;const log=createCallLog({directory:dir,maxBytes:256,clock:()=>now,onError:()=>errors++});log.write('call.created',{reason:'original'});const before=readFileSync(log.file);const stamp=new Date(now).toISOString().replace('T','_').replace(/:/g,'-'),blocked=join(dir,`volna-calls_${stamp}_pid${process.pid}_000001.log.tar.gz.partial`);mkdirSync(blocked);assert.equal(log.write('call.created',{reason:'x'.repeat(160)}),false);assert.deepEqual(readFileSync(log.file),before);assert.equal(errors,1);log.close();
});
test('SDP/stats summaries expose candidate types and counters, never addresses or credentials',()=>{
 const sdp='v=0\r\na=ice-pwd:NEVER-PASSWORD\r\na=candidate:1 1 udp 123 192.168.1.2 1234 typ host\r\na=candidate:2 1 udp 123 5.188.38.29 49161 typ relay\r\na=candidate:3 1 tcp 123 5.188.38.29 49162 typ relay\r\n';assert.deepEqual(callCandidateSummary(sdp),{relay_count:2,host_count:1,srflx_count:0,prflx_count:0,udp_count:2,tcp_count:1});
 const stats=new Map([['local',{id:'local',type:'local-candidate',candidateType:'relay',protocol:'udp',address:'PRIVATE'}],['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'local',currentRoundTripTime:.025}],['out',{type:'outbound-rtp',bytesSent:400,packetsSent:12}],['in',{type:'inbound-rtp',bytesReceived:300,packetsReceived:10,packetsLost:2}]]);assert.deepEqual(callStats(stats),{bytes_sent:400,bytes_received:300,packets_sent:12,packets_received:10,packets_lost:2,candidate_type:'relay',protocol:'udp',rtt_ms:25});assert.ok(!JSON.stringify(callStats(stats)).includes('PRIVATE'));
});
test('real call lifecycle and bounded authorized telemetry are collected without tokens, phones or SDP',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-call-log-api-')),app=createApp({database:':memory:',callLogOptions:{directory:dir}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data)=>{const r=await fixtureFetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const a=(await req('/register','',{username:'caller-logging'})).data,b=(await req('/register','',{username:'callee-logging'})).data,eve=(await req('/register','',{username:'outsider-logging'})).data,chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id,da='a'.repeat(32),db='b'.repeat(32),dc='c'.repeat(32);
 const call=(await req('/calls/start',a.token,{chat_id:chat,device:da,client_id:randomUUID(),protocol:2})).data;const signal={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-pwd:NEVER-SDP-PASSWORD\r\n'};
 assert.equal((await req(`/calls/${call.id}/offer`,a.token,{device:da,description:signal})).status,200);await req('/calls/current?device='+db,b.token);await req(`/calls/${call.id}/accept`,b.token,{device:db,protocol:2});await req(`/calls/${call.id}/answer`,b.token,{device:db,description:{...signal,type:'answer'}});
 const diagnostic={device:da,call_id:call.id,platform:'windows',client_version:'0.13.0',event:'rtc.stats',bytes_sent:100,bytes_received:200,connection:'connected',candidate_type:'relay',sdp:signal.sdp,token:a.token,reason:'NEVER-UNTRUSTED',url:'turn:user:NEVER-TURN-PASSWORD@host',error_type:'NEVER-UNTRUSTED'};
 assert.equal((await req('/calls/diagnostics',eve.token,{...diagnostic,device:dc})).status,404);assert.equal((await req('/calls/diagnostics',a.token,diagnostic)).status,200);
 assert.equal((await req('/calls/diagnostics',a.token,{...diagnostic,event:'unbounded_event'})).status,400);
 for(const [token,d]of [[a.token,da],[b.token,db]])await req(`/calls/${call.id}/media-state`,token,{device:d,connected:true,restart_generation:0});
 await req(`/calls/${call.id}/end`,a.token,{device:da,end_reason:'telecom_disconnect'});assert.equal((await req('/calls/diagnostics',b.token,{...diagnostic,device:db,platform:'android',event:'client.ended'})).status,200);
 const text=readFileSync(join(dir,'volna-calls.log'),'utf8'),rows=text.trim().split('\n').map(JSON.parse);for(const type of ['call.created','call.invited','call.incoming_observed','call.accepted','rtc.answer','call.connected','call.finished','rtc.stats','client.ended'])assert.ok(rows.some(r=>r.event===type),type);
 assert.ok(rows.some(r=>r.reason==='caller_ended'));assert.ok(rows.some(r=>r.event==='call.end_requested'&&r.end_reason==='telecom_disconnect'&&r.role==='caller'));for(const privateValue of [a.token,b.token,a.user.phone,b.user.phone,signal.sdp,'NEVER-SDP-PASSWORD','NEVER-UNTRUSTED','NEVER-TURN-PASSWORD','caller-logging'])assert.ok(!text.includes(privateValue),privateValue);
 for(let i=0;i<119;i++)assert.equal((await req('/calls/diagnostics',a.token,diagnostic)).status,200);assert.equal((await req('/calls/diagnostics',a.token,diagnostic)).status,429);
});
test('call log identifies offer/media timeouts and interrupted calls on restart',async t=>{
 const {calls}=await import('../server/calls.mjs'),app=createApp({database:':memory:'}),events=[];let now=1000000,result;
 const users=['log-timeout-a','log-timeout-b'].map((name,i)=>Number(app.db.prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run(name,name,`+7900000110${i}`).lastInsertRowid)),[a,b]=users,da='a'.repeat(32),db='b'.repeat(32),chat=Number(app.db.prepare("INSERT INTO chats(pair) VALUES('log-timeout')").run().lastInsertRowid);for(const user of users)app.db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(chat,user);
 const options={db:app.db,auth:()=>{},body:async r=>r.data,json:(_,status,data)=>{result=data;},userById:id=>({id}),clock:()=>now,log:(event,data)=>events.push({event,...data})};let service=calls(options);t.after(async()=>{service.close();await app.close();});
 const req=async(path,user,data)=>{await service.handle({method:data===undefined?'GET':'POST',data},{},new URL('http://test/api/calls'+path),user);return result;};
 const start=()=>req('/start',a,{chat_id:chat,device:da,protocol:2,client_id:randomUUID()}),heartbeat=async()=>{await req('/current?device='+da,a);await req('/current?device='+db,b);};
 let call=await start();for(let i=0;i<4;i++){now+=20000;await heartbeat();}assert.ok(events.some(e=>e.event==='call.finished'&&e.call_id===call.id&&e.reason==='offer_timeout'));
 call=await start();const sdp={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};await req(`/${call.id}/offer`,a,{device:da,description:sdp});await req(`/${call.id}/accept`,b,{device:db,protocol:2});await req(`/${call.id}/answer`,b,{device:db,description:{...sdp,type:'answer'}});for(let i=0;i<4;i++){now+=20000;await heartbeat();}assert.ok(events.some(e=>e.event==='call.finished'&&e.call_id===call.id&&e.reason==='media_connect_timeout'));
 const id='d'.repeat(32);app.db.prepare("INSERT INTO call_history(id,chat_id,caller,callee,created,status) VALUES(?,?,?,?,?,'connecting')").run(id,chat,a,b,now);service.close();service=calls(options);assert.ok(events.some(e=>e.event==='call.interrupted'&&e.call_id===id&&e.reason==='server_restart'));assert.equal(app.db.prepare('SELECT status FROM call_history WHERE id=?').get(id).status,'interrupted');
});
test('server collects ICE summaries from legacy signaling and accepts a deduplicated fallback header',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-diag-fallback-')),app=createApp({database:':memory:',callLogOptions:{directory:dir}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data,extra={})=>{const r=await fixtureFetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const a=(await req('/register','',{username:'fallback-caller'})).data,b=(await req('/register','',{username:'fallback-callee'})).data,eve=(await req('/register','',{username:'fallback-outsider'})).data,chat=(await req('/chats',a.token,{user_id:b.user.id})).data.id,da='a'.repeat(32),db='b'.repeat(32);
 const call=(await req('/calls/start',a.token,{chat_id:chat,device:da,client_id:randomUUID(),protocol:2},{'User-Agent':'VolnaAndroid/0.12.100'})).data;
 const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-pwd:PRIVATE-NEVER-LOG\r\na=candidate:1 1 udp 123 5.188.38.29 49160 typ relay\r\n';
 await req(`/calls/${call.id}/offer`,a.token,{device:da,description:{type:'offer',sdp}},{'User-Agent':'VolnaAndroid/0.12.100'});await req(`/calls/${call.id}/accept`,b.token,{device:db,protocol:2});await req(`/calls/${call.id}/answer`,b.token,{device:db,description:{type:'answer',sdp}});
 const payload={event:'rtc.state',platform:'android',client_version:'0.12.101',device:da,call_id:call.id,report_id:'e'.repeat(32),ice:'checking',delivery_http_status:503,delivery_error_type:'NativeApiException',token:'PRIVATE-NEVER-LOG'},header={'X-Volna-Call-Diagnostics':Buffer.from(JSON.stringify(payload)).toString('base64url')};
 assert.equal((await req('/calls/current?device='+da,a.token,undefined,header)).status,200);assert.equal((await req('/calls/diagnostics',a.token,payload)).data.duplicate,true);assert.equal((await req('/calls/current?device='+da,a.token,undefined,header)).status,200);
 // A bad/foreign report cannot break polling or get acknowledged as somebody else's report.
 assert.equal((await req('/calls/current?device='+db,eve.token,undefined,header)).status,200);assert.equal((await req('/calls/diagnostics',eve.token,payload)).status,404);
 assert.equal((await req('/calls/current?device='+da,a.token,undefined,{'X-Volna-Call-Diagnostics':'not valid base64'})).status,200);assert.equal((await req('/calls/diagnostics',a.token,{device:da,event:'invalid',platform:'android'})).status,400);
 const text=readFileSync(join(dir,'volna-calls.log'),'utf8'),rows=text.trim().split('\n').map(JSON.parse),summaries=rows.filter(r=>r.event==='rtc.sdp_summary');assert.equal(summaries.length,2);assert.ok(summaries.every(r=>r.relay_count===1&&r.udp_count===1));assert.ok(summaries.some(r=>r.role==='caller'&&r.client_version==='0.12.100'));const report=rows.filter(r=>r.report_id===payload.report_id);assert.equal(report.length,1);assert.equal(report[0].source,'call_request');assert.equal(report[0].delivery_http_status,503);assert.ok(rows.some(r=>r.event==='call.diagnostics_rejected'&&r.http_status===400));assert.ok(rows.some(r=>r.event==='call.diagnostics_rejected'&&r.http_status===404));assert.ok(!text.includes('PRIVATE-NEVER-LOG'));
});
test('fallback headers are bounded, expire, preserve UTF-8 and carry no session credentials',async()=>{
 const {callDiagnosticHeader}=await import('../client/src/call-diagnostic-transport.mjs');const payload={report_id:'a'.repeat(32),event:'client.stage',client_time:1000,stage:'start',platform:'web'};
 const header=callDiagnosticHeader(payload,2000);assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),payload);assert.equal(callDiagnosticHeader(payload,122000),null);assert.equal(callDiagnosticHeader({...payload,large:'x'.repeat(4000)},2000),null);assert.equal(callDiagnosticHeader({event:'client.stage'},2000),null);
});

test('lifecycle and termination debug fields are bounded and never accept arbitrary messages',async()=>{
 const {diagnosticFields}=await import('../server/call-diagnostics.mjs');
 const {callEndReasons,callLifecycleActions,callEndReason}=await import('../shared/call-debug.mjs');
 for(const end_reason of callEndReasons)assert.equal(diagnosticFields({end_reason}).end_reason,end_reason);
 for(const lifecycle of callLifecycleActions)assert.equal(diagnosticFields({lifecycle}).lifecycle,lifecycle);
 const safe={end_reason:'session_reset',lifecycle:'configure_requested',process_id:'a'.repeat(32),sequence:17,uptime_ms:43000,generation:2,sdk:35,call_status:'active',has_peer:true,operation_active:false,session_same:true,session_blank:true,notify_server:true,model:'Test phone',manufacturer:'Test',call_version:5};
 assert.deepEqual(diagnosticFields({...safe,token:'PRIVATE',message:'PRIVATE',stack:'PRIVATE',sdp:'PRIVATE'}),safe);
 assert.deepEqual(diagnosticFields({end_reason:'PRIVATE',lifecycle:'PRIVATE',process_id:'PRIVATE',model:'x'.repeat(65),manufacturer:'a\nb',sequence:Infinity,generation:-2,notify_server:'true'}),{});
 assert.equal(callEndReason('telecom_abort'),'telecom_abort');assert.equal(callEndReason('PRIVATE'),undefined);
});
test('lifecycle reports before and after a call retain ordering and require authentication',async t=>{
 const dir=tmp(t),app=createApp({database:':memory:',callLogOptions:{directory:dir}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const req=async(path,token,data)=>{const r=await fixtureFetch(`http://127.0.0.1:${app.server.address().port}/api`+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 const a=(await req('/register','',{username:'debug-lifecycle'})).data;
 const payload={event:'client.lifecycle',platform:'android',device:'d'.repeat(32),lifecycle:'configure_requested',session_same:true,sequence:1,process_id:'e'.repeat(32),uptime_ms:12345,sdk:35,model:'Test phone',token:'NEVER-LOG'};
 assert.equal((await req('/calls/diagnostics','',payload)).status,401);
 assert.equal((await req('/calls/diagnostics',a.token,payload)).status,200);
 assert.equal((await req('/calls/diagnostics',a.token,{...payload,sequence:2,lifecycle:'telecom_created',call_id:'f'.repeat(32)})).status,404);
 const text=readFileSync(join(dir,'volna-calls.log'),'utf8'),row=text.trim().split('\n').map(JSON.parse).find(r=>r.event==='client.lifecycle');
 assert.equal(row.sequence,1);assert.equal(row.process_id,payload.process_id);assert.equal(row.uptime_ms,12345);assert.equal(row.session_same,true);assert.ok(!text.includes('NEVER-LOG'));
});

test('call startup bundles media, prefetches one relay session and candidate logs exclude addresses',async()=>{
 const {callRtcConfig,callIceEvent}=await import('../client/src/call-rtc-config.mjs');
 const {diagnosticFields}=await import('../server/call-diagnostics.mjs');
 const servers=[{urls:['turn:example.invalid:3478?transport=udp','turn:example.invalid:3478?transport=tcp'],username:'PRIVATE',credential:'PRIVATE'}],config=callRtcConfig({iceServers:servers,iceTransportPolicy:'all'});
 assert.equal(config.iceServers,servers);assert.equal(config.iceTransportPolicy,'relay');assert.equal(config.bundlePolicy,'max-bundle');assert.equal(config.rtcpMuxPolicy,'require');assert.equal(config.iceCandidatePoolSize,1);
 const event=callIceEvent('candidate:1 1 UDP 123 192.168.1.10 49160 typ relay raddr 10.0.0.1 rport 123 ufrag PRIVATE');assert.deepEqual(event,{candidate_type:'relay',protocol:'udp'});assert.deepEqual(callIceEvent('PRIVATE'),{});
 assert.deepEqual(diagnosticFields({bundle_policy:'max-bundle',candidate_pool_size:1,...event,sdp:'PRIVATE'}),{bundle_policy:'max-bundle',candidate_type:'relay',protocol:'udp',candidate_pool_size:1});
});
