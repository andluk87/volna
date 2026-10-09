import {randomBytes,createHmac} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function calls({db,auth,body,json,userById,turnSecret=process.env.TURN_SECRET||'',turnHost=process.env.TURN_HOST||'',clock=Date.now,onRing=()=>{},onEnd=()=>{}}){
 const active=new Map(), attempts=new Map();
 db.exec(`CREATE TABLE IF NOT EXISTS call_history(id TEXT PRIMARY KEY,chat_id INTEGER NOT NULL REFERENCES chats(id),
  caller INTEGER NOT NULL REFERENCES users(id),callee INTEGER NOT NULL REFERENCES users(id),created INTEGER NOT NULL,
  answered INTEGER,ended INTEGER,status TEXT NOT NULL,screen_shared INTEGER NOT NULL DEFAULT 0,ringed INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS call_history_caller ON call_history(caller,created);
  CREATE INDEX IF NOT EXISTS call_history_callee ON call_history(callee,created);`);
 if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name==='video'))db.exec('ALTER TABLE call_history ADD COLUMN video INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(call_history)').all().some(column=>column.name==='ringed'))db.exec('ALTER TABLE call_history ADD COLUMN ringed INTEGER NOT NULL DEFAULT 1');
 db.prepare("UPDATE call_history SET ended=?,status='interrupted' WHERE ended IS NULL").run(clock());
 const finish=(c,status)=>{active.delete(c.id);db.prepare('UPDATE call_history SET ended=?,status=? WHERE id=?').run(clock(),status,c.id);onEnd(c.id);};
 const device=value=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))throw fail(400,'Некорректное устройство');return value;};
 const sweep=()=>{const now=clock();for(const [uid,item] of attempts)if(now-item.start>60000)attempts.delete(uid);for(const c of active.values())if(now-c.created>4*3600000||now-c.callerSeen>50000||(c.status==='active'?now-c.calleeSeen>50000:c.status==='connecting'?now-c.acceptedAt>60000:now-c.created>60000))finish(c,c.status==='ringing'?'missed':'interrupted');};
 const view=(c,uid,d)=>{
  if(!c)return null;const caller=c.caller===uid,owned=caller?c.callerDevice===d:c.calleeDevice===d;
  if(!owned&&(caller||c.calleeDevice))return {id:c.id,status:'other-device'};
  if(!caller&&c.status==='preparing')return null;
  return {id:c.id,chat_id:c.chat,peer:userById(caller?c.callee:c.caller),incoming:!caller,status:c.status,created:c.created,video:!!c.video,
    peer_video:!!(caller?c.calleeCamera:c.callerCamera),peer_sharing:!!(caller?c.calleeSharing:c.callerSharing),offer:!caller?c.offer:undefined,answer:caller?c.answer:undefined};
 };
 const sdp=(value,type)=>{if(!value||value.type!==type||typeof value.sdp!=='string'||value.sdp.length>24000||!value.sdp.startsWith('v=0')||!value.sdp.includes('m=audio')||value.sdp.includes('m=application'))throw fail(400,'Некорректные параметры звонка');return {type,sdp:value.sdp};};
 const timer=setInterval(sweep,5000);timer.unref();
 async function handle(req,res,url,uid){
  if(!url.pathname.startsWith('/api/calls'))return false;sweep();
  if(url.pathname==='/api/calls/history'&&req.method==='GET'){
   const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
   if(!Number.isSafeInteger(before)||before<1)throw fail(400,'Некорректный курсор');
   const rows=db.prepare('SELECT * FROM call_history WHERE (caller=? OR (callee=? AND ringed=1)) AND created<? ORDER BY created DESC,id DESC LIMIT 50').all(uid,uid,before);
   json(res,200,rows.map(c=>({id:c.id,chat_id:c.chat_id,peer:userById(c.caller===uid?c.callee:c.caller),incoming:c.callee===uid,created:c.created,
    ended:c.ended,status:c.status,duration:c.answered?Math.max(0,Math.floor(((c.ended??clock())-c.answered)/1000)):0,screen_shared:!!c.screen_shared,video:!!c.video})));return true;
  }
  if(url.pathname==='/api/calls/config'&&req.method==='GET'){
   const iceServers=[];
   if(turnHost&&turnSecret){const username=`${Math.floor(clock()/1000)+5*3600}:${uid}`;iceServers.push({urls:[`turn:${turnHost}:3478?transport=udp`,`turn:${turnHost}:3478?transport=tcp`],username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}
   json(res,200,{iceServers,relayConfigured:iceServers.length>0});return true;
  }
  if(url.pathname==='/api/calls/current'&&req.method==='GET'){
   const d=device(url.searchParams.get('device'));const c=[...active.values()].find(c=>c.caller===uid||c.callee===uid);
   if(c){if(c.caller===uid&&c.callerDevice===d)c.callerSeen=clock();if(c.callee===uid&&c.calleeDevice===d)c.calleeSeen=clock();}
   json(res,200,view(c,uid,d));return true;
  }
  if(req.method!=='POST')return false;
  const data=await body(req);auth(req);sweep();const d=device(data.device);
  if(url.pathname==='/api/calls/start'){
   const rate=attempts.get(uid)||{start:clock(),count:0};attempts.set(uid,rate);if(++rate.count>10)throw fail(429,'Не более 10 попыток звонка в минуту');
   if(!Number.isSafeInteger(data.chat_id)||data.chat_id<1)throw fail(400,'Некорректный чат');
   if(data.video!==undefined&&typeof data.video!=='boolean')throw fail(400,'Некорректный тип звонка');
   const chat=db.prepare("SELECT c.id FROM chats c JOIN members m ON c.id=m.chat_id WHERE c.id=? AND c.kind='direct' AND m.user_id=?").get(Number(data.chat_id),uid);
   if(!chat)throw fail(404,'Личный чат не найден');
   const peer=db.prepare('SELECT user_id FROM members WHERE chat_id=? AND user_id<>?').get(chat.id,uid)?.user_id;if(!peer)throw fail(404,'Собеседник не найден');
   if([...active.values()].some(c=>[c.caller,c.callee].some(id=>id===uid||id===peer)))throw fail(409,'Вы или собеседник уже участвуете в звонке');
   if(active.size>=100)throw fail(503,'Сервер звонков занят');
   const c={id:randomBytes(16).toString('hex'),caller:uid,callee:peer,chat:chat.id,callerDevice:d,calleeDevice:null,status:'preparing',video:!!data.video,created:clock(),callerSeen:clock(),calleeSeen:clock()};
   db.prepare('INSERT INTO call_history(id,chat_id,caller,callee,created,status,video) VALUES(?,?,?,?,?,?,?)').run(c.id,c.chat,uid,peer,c.created,c.status,c.video?1:0);
   active.set(c.id,c);json(res,201,view(c,uid,d));return true;
  }
  const match=url.pathname.match(/^\/api\/calls\/([a-f0-9]{32})\/(offer|accept|answer|screen|camera|end)$/);if(!match)throw fail(404,'Не найдено');
  const c=active.get(match[1]);if(!c||![c.caller,c.callee].includes(uid))throw fail(404,'Звонок завершён');
  const caller=c.caller===uid,op=match[2];
  if(caller?c.callerDevice!==d:c.calleeDevice&&c.calleeDevice!==d)throw fail(409,'Звонок открыт на другом устройстве');
  if(op==='end'){finish(c,c.status==='active'?'ended':c.status==='ringing'?(caller?'cancelled':'declined'):'interrupted');json(res,200,{ok:true});return true;}
  if(op==='screen'){
   if(c.status!=='active')throw fail(409,'Сначала соедините звонок');
   if(typeof data.sharing!=='boolean')throw fail(400,'Некорректное состояние демонстрации');
   if(data.sharing&&(!c.offer?.sdp.includes('m=video')||!c.answer?.sdp.includes('m=video')))throw fail(409,'Видеоканал не согласован');
   if(caller){c.callerSharing=data.sharing;if(data.sharing)c.callerCamera=false;}else{c.calleeSharing=data.sharing;if(data.sharing)c.calleeCamera=false;}
   if(data.sharing)db.prepare('UPDATE call_history SET screen_shared=1 WHERE id=?').run(c.id);
  }
  if(op==='camera'){
   if(c.status!=='active')throw fail(409,'Сначала соедините звонок');
   if(typeof data.enabled!=='boolean')throw fail(400,'Некорректное состояние камеры');
   if(data.enabled&&(!c.offer?.sdp.includes('m=video')||!c.answer?.sdp.includes('m=video')))throw fail(409,'Видеоканал не согласован');
   if(caller){c.callerCamera=data.enabled;if(data.enabled)c.callerSharing=false;}else{c.calleeCamera=data.enabled;if(data.enabled)c.calleeSharing=false;}
   if(data.enabled)db.prepare('UPDATE call_history SET video=1 WHERE id=?').run(c.id);
  }
  if(op==='offer'){if(!caller||c.status!=='preparing')throw fail(409,'Предложение уже отправлено');c.offer=sdp(data.description,'offer');c.status='ringing';c.callerSeen=clock();db.prepare('UPDATE call_history SET ringed=1 WHERE id=?').run(c.id);onRing(c);}
  if(op==='accept'){if(caller||c.status!=='ringing')throw fail(409,'Звонок уже принят или завершён');c.calleeDevice=d;c.calleeSeen=clock();c.acceptedAt=clock();c.status='connecting';}
  if(op==='answer'){if(caller||c.status!=='connecting'||c.calleeDevice!==d)throw fail(409,'Сначала примите звонок');c.answer=sdp(data.description,'answer');c.status='active';c.calleeSeen=clock();db.prepare('UPDATE call_history SET answered=? WHERE id=?').run(clock(),c.id);}
  db.prepare('UPDATE call_history SET status=? WHERE id=?').run(c.status,c.id);
  json(res,200,view(c,uid,d));return true;
 }
 return {handle,close:()=>{clearInterval(timer);for(const c of active.values())finish(c,'interrupted');}};
}
