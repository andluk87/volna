/** Visible-window leases, independent from background SSE/push connections. */
export function createPresence({db,onChange=()=>{},clock=Date.now,ttl=25000}){
 const entries=new Map(),onlineUsers=new Set();
 function refresh(uid){const now=clock(),online=[...entries.values()].some(e=>e.uid===uid&&e.visible&&e.at+ttl>now);if(online!==onlineUsers.has(uid)){if(online)onlineUsers.add(uid);else onlineUsers.delete(uid);onChange(uid,online);}return online;}
 function update(uid,session,{client,visible,sequence}){
  if(typeof client!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(client)||typeof visible!=='boolean'||!Number.isSafeInteger(sequence)||sequence<0)throw Object.assign(Error('Некорректный статус активности'),{status:400});
  const key=uid+':'+client,previous=entries.get(key);if(previous&&previous.sequence>=sequence)return {online:refresh(uid)};
  if(!previous&&[...entries.values()].filter(e=>e.uid===uid).length>=32)throw Object.assign(Error('Слишком много окон активности'),{status:429});
  entries.set(key,{uid,session,visible,sequence,at:clock()});if(visible||previous?.visible)db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(clock(),uid);return {online:refresh(uid)};
 }
 function sweep(){const now=clock(),users=new Set();for(const [key,e]of entries){users.add(e.uid);if(e.at+120000<now)entries.delete(key);}for(const uid of users)refresh(uid);}
 function removeSession(token){const users=new Set();for(const [key,e]of entries)if(e.session===token){users.add(e.uid);entries.delete(key);}for(const uid of users)refresh(uid);}
 const timer=setInterval(sweep,5000);timer.unref();
 return {update,online:uid=>refresh(uid),removeSession,sweep,close:()=>{clearInterval(timer);entries.clear();onlineUsers.clear();}};
}
