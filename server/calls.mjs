import {callPolicy} from './call-policy.mjs';
import {randomBytes,createHmac} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function calls({db,auth,body,json,userById,turnSecret=process.env.TURN_SECRET||'',turnHost=process.env.TURN_HOST||'',clock=Date.now,onRing=()=>{},onEnd=()=>{},onChange=()=>{},onEvent=()=>{},ringTimeout=45000,connectTimeout=60000,reconnectTimeout=20000,turnTlsUrls=process.env.TURN_TLS_URLS||''}){
 const active=new Map(), attempts=new Map();
 const ttl={ring:Math.max(30000,Math.min(60000,Number(ringTimeout)||45000)),connect:Math.max(10000,Math.min(90000,Number(connectTimeout)||60000)),reconnect:Math.max(10000,Math.min(30000,Number(reconnectTimeout)||20000))};
 db.exec(`CREATE TABLE IF NOT EXISTS call_history(id TEXT PRIMARY KEY,chat_id INTEGER NOT NULL REFERENCES chats(id),
  caller INTEGER NOT NULL REFERENCES users(id),callee INTEGER NOT NULL REFERENCES users(id),created INTEGER NOT NULL,
  answered INTEGER,ended INTEGER,status TEXT NOT NULL,screen_shared INTEGER NOT NULL DEFAULT 0,ringed INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS call_history_caller ON call_history(caller,created);
  CREATE INDEX IF NOT EXISTS call_history_callee ON call_history(callee,created);`);
 db.exec('CREATE TABLE IF NOT EXISTS call_history_hidden(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,call_id TEXT NOT NULL REFERENCES call_history(id) ON DELETE CASCADE,PRIMARY KEY(user_id,call_id))');
 if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name==='video'))db.exec('ALTER TABLE call_history ADD COLUMN video INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name==='ringed'))db.exec('ALTER TABLE call_history ADD COLUMN ringed INTEGER NOT NULL DEFAULT 1');
 if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name==='callee_read'))db.exec('ALTER TABLE call_history ADD COLUMN callee_read INTEGER NOT NULL DEFAULT 1');
 db.exec('CREATE INDEX IF NOT EXISTS call_history_chat_created ON call_history(chat_id,created)');
 for(const [name,type] of Object.entries({version:'INTEGER NOT NULL DEFAULT 0',idempotency_key:'TEXT',caller_device:'TEXT',callee_device:'TEXT'}))if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name===name))db.exec(`ALTER TABLE call_history ADD COLUMN ${name} ${type}`);
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS call_request_key ON call_history(caller,idempotency_key) WHERE idempotency_key IS NOT NULL;
 CREATE TABLE IF NOT EXISTS call_events(event_id TEXT PRIMARY KEY,call_id TEXT NOT NULL REFERENCES call_history(id) ON DELETE CASCADE,version INTEGER NOT NULL,type TEXT NOT NULL,created INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS call_events_call ON call_events(call_id,version);`);
 db.prepare("UPDATE call_history SET ended=?,status='interrupted',version=version+1,callee_read=CASE WHEN ringed=1 AND answered IS NULL THEN 0 ELSE 1 END WHERE ended IS NULL").run(clock());
 db.prepare('DELETE FROM call_events WHERE created<?').run(clock()-30*86400000);
 const change=(c,type)=>{c.version++;db.prepare('UPDATE call_history SET status=?,version=? WHERE id=?').run(c.status,c.version,c.id);const event={event_id:randomBytes(16).toString('hex'),call_id:c.id,type,sequence:c.version,schema_version:1,sent_at:clock(),expires_at:clock()+ttl.ring,payload:{chat_id:c.chat}};db.prepare('INSERT INTO call_events(event_id,call_id,version,type,created) VALUES(?,?,?,?,?)').run(event.event_id,c.id,c.version,type,clock());onEvent([c.caller,c.callee],event);};
 const finish=(c,status)=>{if(!active.has(c.id))return;active.delete(c.id);c.status=status;change(c,'call.ended');db.prepare('UPDATE call_history SET ended=?,callee_read=? WHERE id=?').run(clock(),c.ringed&&!c.acceptedAt&&status!=='declined'?0:1,c.id);onEnd(c.id);onChange(c.chat,[c.caller,c.callee]);};
 const policy=callPolicy({db,auth,body,json,userById,onBlock:(uid,peer)=>{for(const c of active.values())if([c.caller,c.callee].includes(uid)&&[c.caller,c.callee].includes(peer))finish(c,c.connectedAt?'ended':'interrupted');}});
 const device=value=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))throw fail(400,'Некорректное устройство');return value;};
 const sweep=()=>{const now=clock();for(const [uid,item] of attempts)if(now-item.start>60000)attempts.delete(uid);for(const c of active.values())if(now-c.created>4*3600000||now-c.callerSeen>50000||c.acceptedAt&&now-c.calleeSeen>50000||c.recovering&&now-c.restartAt>ttl.reconnect||c.status==='preparing'&&now-c.created>ttl.connect||c.status==='ringing'&&now-c.ringAt>(c.callerProtocol===2?ttl.ring:60000)||c.status==='connecting'&&now-c.acceptedAt>ttl.connect||c.mediaReporting&&!c.connectedAt&&c.acceptedAt&&now-c.acceptedAt>ttl.connect)finish(c,c.status==='ringing'?'missed':'interrupted');};
 const view=(c,uid,d)=>{
  if(!c)return null;const caller=c.caller===uid,owned=caller?c.callerDevice===d:c.calleeDevice===d;
  if(!owned&&(caller||c.calleeDevice))return {id:c.id,status:'other-device',reason:'answered_elsewhere',version:c.version};
  if(!caller&&c.status==='preparing')return null;
  return {id:c.id,version:c.version,protocol:2,media_reporting:!!c.mediaReporting,relay_only:!!c.relayOnly,restart_generation:c.restartGeneration,restart_requested:!!c.restartRequested,reconnecting:!!c.recovering,connected_at:c.connectedAt||null,expires_at:(c.ringAt||c.created)+ttl.ring,chat_id:c.chat,peer:userById(caller?c.callee:c.caller),incoming:!caller,status:c.status,created:c.created,video:!!c.video,ring_received:!!c.ringReceived,
    peer_video:!!(caller?c.calleeCamera:c.callerCamera),peer_sharing:!!(caller?c.calleeSharing:c.callerSharing),offer:!caller?c.offer:undefined,answer:caller?c.answer:undefined};
 };
 const sdp=(value,type)=>{if(!value||value.type!==type||typeof value.sdp!=='string'||value.sdp.length>24000||!value.sdp.startsWith('v=0')||!value.sdp.includes('m=audio')||value.sdp.includes('m=application'))throw fail(400,'Некорректные параметры звонка');return {type,sdp:value.sdp};};
 const timer=setInterval(sweep,5000);timer.unref();
 async function handle(req,res,url,uid){
  if(!url.pathname.startsWith('/api/calls'))return false;sweep();
  if(await policy.handle(req,res,url,uid))return true;
  if(url.pathname==='/api/calls/read'&&req.method==='POST'){
   const data=await body(req);auth(req);
   if(!Number.isSafeInteger(data.chat_id)||!Array.isArray(data.call_ids)||data.call_ids.length>1000||data.call_ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))throw fail(400,'Некорректные звонки');
   if(!db.prepare("SELECT 1 FROM members m JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.user_id=? AND c.admin_deleted=0").get(data.chat_id,uid))throw fail(404,'Чат не найден');
   const mark=db.prepare('UPDATE call_history SET callee_read=1 WHERE id=? AND chat_id=? AND callee=? AND callee_read=0 AND ended IS NOT NULL');
   let changed=0;for(const id of data.call_ids)changed+=mark.run(id,data.chat_id,uid).changes;
   if(changed)onChange(data.chat_id,[uid]);
   json(res,200,{ok:true});return true;
  }
  if(url.pathname==='/api/calls/history'&&req.method==='GET'){
   const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
   if(!Number.isSafeInteger(before)||before<1)throw fail(400,'Некорректный курсор');
   const chatId=url.searchParams.has('chat_id')?Number(url.searchParams.get('chat_id')):null;
   if(chatId!==null&&(!Number.isSafeInteger(chatId)||chatId<1))throw fail(400,'Некорректный чат');
   if(chatId!==null&&!db.prepare("SELECT 1 FROM chats c JOIN members m ON c.id=m.chat_id WHERE c.id=? AND m.user_id=? AND c.kind='direct' AND c.admin_deleted=0").get(chatId,uid))throw fail(404,'Личный чат не найден');
   const rows=db.prepare('SELECT * FROM call_history WHERE (caller=? OR (callee=? AND ringed=1)) AND created<? AND NOT EXISTS (SELECT 1 FROM call_history_hidden h WHERE h.call_id=call_history.id AND h.user_id=?)'+(chatId===null?'':' AND chat_id=?')+' ORDER BY created DESC,id DESC LIMIT 50').all(uid,uid,before,uid,...(chatId===null?[]:[chatId]));
   json(res,200,rows.map(c=>({id:c.id,chat_id:c.chat_id,peer:userById(c.caller===uid?c.callee:c.caller),incoming:c.callee===uid,created:c.created,
    ended:c.ended,status:c.status,duration:c.answered?Math.max(0,Math.floor(((c.ended??clock())-c.answered)/1000)):0,screen_shared:!!c.screen_shared,video:!!c.video})));return true;
  }
  if(url.pathname==='/api/calls/history/clear'&&req.method==='POST'){
   const data=await body(req);auth(req);const before=data.before;
   if(!Number.isSafeInteger(before)||before<1||before>clock())throw fail(400,'Некорректный момент очистки');
   db.prepare('INSERT OR IGNORE INTO call_history_hidden(user_id,call_id) SELECT ?,id FROM call_history WHERE (caller=? OR (callee=? AND ringed=1)) AND ended IS NOT NULL AND created<=?').run(uid,uid,uid,before);
   onChange(null,[uid]);json(res,200,{ok:true});return true;
  }
  if(url.pathname==='/api/calls/config'&&req.method==='GET'){
   const iceServers=[];
   if(turnHost&&turnSecret){const username=`${Math.floor(clock()/1000)+5*3600}:${uid}`;iceServers.push({urls:[`turn:${turnHost}:3478?transport=udp`,`turn:${turnHost}:3478?transport=tcp`],username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}
   const tls=String(turnTlsUrls).split(',').map(x=>x.trim()).filter(x=>/^turns:[a-zA-Z0-9.-]+:443\?transport=tcp$/.test(x));if(tls.length&&turnSecret){const username=`${Math.floor(clock()/1000)+5*3600}:${uid}`;iceServers.push({urls:tls,username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}
   const selected=url.searchParams.get('call_id'),c=selected?active.get(selected):null;if(selected&&(!c||![c.caller,c.callee].includes(uid)))throw fail(404,'Звонок недоступен');
   json(res,200,{iceServers,relayConfigured:iceServers.length>0,iceTransportPolicy:(c?.relayOnly||policy.get(uid).relay_only)?'relay':'all',turnTlsConfigured:tls.length>0&&!!turnSecret,timeouts:ttl});return true;
  }
  if(url.pathname==='/api/calls/current'&&req.method==='GET'){
   const d=device(url.searchParams.get('device'));const c=[...active.values()].find(c=>c.caller===uid||c.callee===uid);
   if(c){if(c.caller===uid&&c.callerDevice===d)c.callerSeen=clock();if(c.callee===uid&&c.calleeDevice===d)c.calleeSeen=clock();}
   json(res,200,view(c,uid,d));return true;
  }
  const detail=url.pathname.match(/^\/api\/calls\/([a-f0-9]{32})$/);
  if(detail&&req.method==='GET'){const row=db.prepare('SELECT * FROM call_history WHERE id=? AND (caller=? OR callee=?)').get(detail[1],uid,uid);if(!row)throw fail(404,'Звонок недоступен');const c=active.get(row.id);json(res,200,c?view(c,uid,device(url.searchParams.get('device'))):{id:row.id,status:row.status,version:row.version,ended:row.ended});return true;}
  if(req.method!=='POST')return false;
  const data=await body(req);auth(req);sweep();const d=device(data.device);
  if(url.pathname==='/api/calls/start'){
   const key=data.client_id??null;if(key!==null&&(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(key)))throw fail(400,'Некорректный ключ запроса');
   if(key){const old=db.prepare('SELECT * FROM call_history WHERE caller=? AND idempotency_key=?').get(uid,key);if(old){if(old.chat_id!==data.chat_id||old.caller_device!==d||!!old.video!==!!data.video)throw fail(409,'Ключ звонка уже использован');const c=active.get(old.id);json(res,200,c?view(c,uid,d):{id:old.id,status:old.status,version:old.version,ended:old.ended});return true;}}
   const rate=attempts.get(uid)||{start:clock(),count:0};attempts.set(uid,rate);if(++rate.count>10)throw fail(429,'Не более 10 попыток звонка в минуту');
   if(!Number.isSafeInteger(data.chat_id)||data.chat_id<1)throw fail(400,'Некорректный чат');
   if(data.video!==undefined&&typeof data.video!=='boolean')throw fail(400,'Некорректный тип звонка');
   const chat=db.prepare("SELECT c.id FROM chats c JOIN members m ON c.id=m.chat_id WHERE c.id=? AND c.kind='direct' AND c.admin_deleted=0 AND c.admin_locked=0 AND m.user_id=?").get(Number(data.chat_id),uid);
   if(!chat)throw fail(404,'Личный чат не найден');
   const peer=db.prepare('SELECT user_id FROM members WHERE chat_id=? AND user_id<>?').get(chat.id,uid)?.user_id;if(!peer||db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(peer)?.admin_blocked)throw fail(404,'Собеседник недоступен');
   if(!policy.allowed(uid,peer))throw fail(404,'Собеседник недоступен');
   if([...active.values()].some(c=>[c.caller,c.callee].some(id=>id===uid||id===peer)))throw fail(409,'Вы или собеседник уже участвуете в звонке');
   if(active.size>=100)throw fail(503,'Сервер звонков занят');
   const c={id:randomBytes(16).toString('hex'),caller:uid,callee:peer,chat:chat.id,callerDevice:d,calleeDevice:null,status:'preparing',ringReceipt:randomBytes(24).toString('hex'),video:!!data.video,created:clock(),callerSeen:clock(),calleeSeen:clock(),version:0,callerProtocol:data.protocol===2?2:1,calleeProtocol:1,restartGeneration:0,relayOnly:!!policy.get(uid).relay_only||!!policy.get(peer).relay_only};
   db.prepare('INSERT INTO call_history(id,chat_id,caller,callee,created,status,video) VALUES(?,?,?,?,?,?,?)').run(c.id,c.chat,uid,peer,c.created,c.status,c.video?1:0);
   db.prepare('UPDATE call_history SET idempotency_key=?,caller_device=? WHERE id=?').run(key,d,c.id);
   active.set(c.id,c);change(c,'call.created');json(res,201,view(c,uid,d));return true;
  }
  const match=url.pathname.match(/^\/api\/calls\/([a-f0-9]{32})\/(offer|ringing|accept|answer|screen|camera|end|media-state|ice-restart)$/);if(!match)throw fail(404,'Не найдено');
  const c=active.get(match[1]);if(!c){const old=db.prepare('SELECT * FROM call_history WHERE id=? AND (caller=? OR callee=?)').get(match[1],uid,uid);if(old&&match[2]==='end'&&(old.caller===uid?old.caller_device===d:old.callee_device===d)){json(res,200,{ok:true});return true;}throw fail(404,'Звонок завершён');}if(![c.caller,c.callee].includes(uid))throw fail(404,'Звонок завершён');
  const caller=c.caller===uid,op=match[2];
  if(caller?c.callerDevice!==d:c.calleeDevice&&c.calleeDevice!==d)throw Object.assign(fail(409,'Звонок принят на другом устройстве'),{code:'CALL_ANSWERED_ELSEWHERE'});
  if(data.expected_version!==undefined&&(!Number.isSafeInteger(data.expected_version)||data.expected_version!==c.version))throw Object.assign(fail(409,'Состояние звонка изменилось'),{code:'STALE_CALL_VERSION'});
  if(op==='ringing'){if(caller||c.status!=='ringing')throw fail(409,'Подтверждение доступно только получателю входящего звонка');if(!c.ringReceived){c.ringReceived=true;change(c,'call.ringing');}}
  if(op==='end'){if(!caller&&!c.calleeDevice){c.calleeDevice=d;db.prepare('UPDATE call_history SET callee_device=? WHERE id=?').run(d,c.id);}finish(c,c.connectedAt||c.status==='active'&&!c.mediaReporting?'ended':c.status==='ringing'?(caller?'cancelled':'declined'):'interrupted');json(res,200,{ok:true});return true;}
  if(op==='ice-restart'){
   if(c.status!=='active'||!c.mediaReporting)throw fail(409,'Обновите оба клиента для восстановления сети');
   if(data.description){if(!caller)throw fail(403,'Новый offer создаёт инициатор');const offer=sdp(data.description,'offer');if(data.restart_generation===c.restartGeneration-1&&JSON.stringify(offer)===JSON.stringify(c.offer)){json(res,200,view(c,uid,d));return true;}if(data.restart_generation!==c.restartGeneration)throw fail(409,'Устаревшее восстановление');if(!c.recovering){c.restartAt=clock();c.recovering=true;}c.restartGeneration++;c.offer=offer;c.answer=null;c.restartRequested=false;c.callerConnected=false;c.calleeConnected=false;change(c,'rtc.ice_restart');}
   else if(!c.recovering){c.restartAt=clock();c.recovering=true;c.restartRequested=true;change(c,'call.reconnecting');}
   json(res,200,view(c,uid,d));return true;
  }
  if(op==='media-state'){
   if(c.status!=='active'||typeof data.connected!=='boolean')throw fail(409,'Медиаканал ещё не согласован');
   if(data.restart_generation!==c.restartGeneration)throw fail(409,'Устаревший медиаканал');
   const field=caller?'callerConnected':'calleeConnected';c[field]=data.connected;
   if(c.callerConnected&&c.calleeConnected){if(!c.connectedAt){c.connectedAt=clock();db.prepare('UPDATE call_history SET answered=? WHERE id=?').run(c.connectedAt,c.id);change(c,'call.connected');}if(c.recovering){c.recovering=false;c.restartRequested=false;change(c,'call.reconnected');}}
   json(res,200,view(c,uid,d));return true;
  }
  if(op==='screen'){
   if(c.status!=='active')throw fail(409,'Сначала соедините звонок');
   if(typeof data.sharing!=='boolean')throw fail(400,'Некорректное состояние демонстрации');
   if(data.sharing&&(!c.offer?.sdp.includes('m=video')||!c.answer?.sdp.includes('m=video')))throw fail(409,'Видеоканал не согласован');
   if(caller){c.callerSharing=data.sharing;if(data.sharing)c.callerCamera=false;}else{c.calleeSharing=data.sharing;if(data.sharing)c.calleeCamera=false;}
   if(data.sharing)db.prepare('UPDATE call_history SET screen_shared=1 WHERE id=?').run(c.id);change(c,'call.screen');
  }
  if(op==='camera'){
   if(c.status!=='active')throw fail(409,'Сначала соедините звонок');
   if(typeof data.enabled!=='boolean')throw fail(400,'Некорректное состояние камеры');
   if(data.enabled&&(!c.offer?.sdp.includes('m=video')||!c.answer?.sdp.includes('m=video')))throw fail(409,'Видеоканал не согласован');
   if(caller){c.callerCamera=data.enabled;if(data.enabled)c.callerSharing=false;}else{c.calleeCamera=data.enabled;if(data.enabled)c.calleeSharing=false;}
   if(data.enabled)db.prepare('UPDATE call_history SET video=1 WHERE id=?').run(c.id);change(c,'call.camera');
  }
  if(op==='offer'&&caller&&c.offer&&JSON.stringify(sdp(data.description,'offer'))===JSON.stringify(c.offer)&&c.restartGeneration===0){json(res,200,view(c,uid,d));return true;}
  if(op==='offer'){if(!caller||c.status!=='preparing')throw fail(409,'Предложение уже отправлено');c.offer=sdp(data.description,'offer');c.status='ringing';c.ringAt=clock();c.ringed=true;c.callerSeen=clock();change(c,'call.invited');db.prepare('UPDATE call_history SET ringed=1 WHERE id=?').run(c.id);onRing(c);}
  if(op==='accept'&&!caller&&c.calleeDevice===d){json(res,200,view(c,uid,d));return true;}
  if(op==='accept'){if(caller||c.status!=='ringing')throw fail(409,'Звонок уже принят или завершён');c.calleeDevice=d;c.calleeSeen=clock();c.acceptedAt=clock();c.status='connecting';c.calleeProtocol=data.protocol===2?2:1;c.mediaReporting=c.callerProtocol===2&&c.calleeProtocol===2;db.prepare('UPDATE call_history SET callee_device=? WHERE id=?').run(d,c.id);change(c,'call.accepted');}
  if(op==='answer'){
   if(!caller&&c.calleeDevice===d&&c.answer&&JSON.stringify(sdp(data.description,'answer'))===JSON.stringify(c.answer)&&(data.restart_generation??0)===c.restartGeneration){json(res,200,view(c,uid,d));return true;}
   const recovering=c.status==='active'&&c.recovering;
   if(caller||!(c.status==='connecting'||recovering)||c.calleeDevice!==d)throw fail(409,'Сначала примите звонок');
   if((data.restart_generation??0)!==c.restartGeneration)throw fail(409,'Устаревший ответ');
   const answer=sdp(data.description,'answer');if(c.answer&&JSON.stringify(c.answer)!==JSON.stringify(answer))throw fail(409,'Ответ уже установлен');
   c.answer=answer;c.status='active';c.calleeSeen=clock();if(!c.mediaReporting&&!c.connectedAt){c.connectedAt=clock();db.prepare('UPDATE call_history SET answered=? WHERE id=?').run(c.connectedAt,c.id);}change(c,'rtc.answer');
  }
  db.prepare('UPDATE call_history SET status=? WHERE id=?').run(c.status,c.id);
  json(res,200,view(c,uid,d));return true;
 }
 async function receiptHandle(req,res,url){
  const match=url.pathname.match(/^\/api\/calls\/([a-f0-9]{32})\/ringing-receipt$/);if(!match)return false;
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
  const data=await body(req),c=active.get(match[1]);
  if(!c||c.status!=='ringing'||clock()-(c.ringAt||c.created)>=(c.callerProtocol===2?ttl.ring:60000)||typeof data.receipt!=='string'||data.receipt!==c.ringReceipt)throw fail(404,'Подтверждение недоступно');
  c.ringReceived=true;json(res,200,{ok:true});return true;
 }
 return {handle,receiptHandle,receipt:id=>{const c=active.get(id);return c?.status==='ringing'?c.ringReceipt:null;},list:()=>[...active.values()].map(c=>({id:c.id,chat_id:c.chat,caller:c.caller,callee:c.callee,status:c.status,created:c.created,video:!!c.video})),terminate:id=>{const c=active.get(id);if(!c)throw fail(404,'Активный звонок не найден');finish(c,'interrupted');},close:()=>{clearInterval(timer);for(const c of active.values())finish(c,'interrupted');}};
}
