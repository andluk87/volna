const fail=(status,message)=>Object.assign(new Error(message),{status});
export function callPolicy({db,auth,body,json,userById,onBlock}){
 db.exec(`CREATE TABLE IF NOT EXISTS call_privacy(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,allow_calls TEXT NOT NULL DEFAULT 'everyone',relay_only INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS call_blocks(owner INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,peer INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(owner,peer));`);
 const get=uid=>db.prepare('SELECT * FROM call_privacy WHERE user_id=?').get(uid)||{allow_calls:'everyone',relay_only:0};
 const blocked=(a,b)=>!!db.prepare('SELECT 1 FROM call_blocks WHERE (owner=? AND peer=?) OR (owner=? AND peer=?)').get(a,b,b,a);
 const allowed=(caller,callee)=>{if(blocked(caller,callee))return false;const p=get(callee);return p.allow_calls==='everyone'||p.allow_calls==='contacts'&&!!db.prepare('SELECT 1 FROM account_contacts WHERE owner=? AND linked=? AND deleted=0').get(callee,caller);};
 const response=uid=>({...get(uid),relay_only:!!get(uid).relay_only,blocked:db.prepare('SELECT peer FROM call_blocks WHERE owner=? ORDER BY peer LIMIT 500').all(uid).map(row=>userById(row.peer)).filter(Boolean)});
 async function handle(req,res,url,uid){
  if(url.pathname==='/api/calls/privacy'){
   if(req.method==='GET'){json(res,200,response(uid));return true;}
   if(req.method==='POST'){const data=await body(req);auth(req);if(!['everyone','contacts','nobody'].includes(data.allow_calls)||typeof data.relay_only!=='boolean')throw fail(400,'Некорректные настройки звонков');db.prepare('INSERT INTO call_privacy(user_id,allow_calls,relay_only) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET allow_calls=excluded.allow_calls,relay_only=excluded.relay_only').run(uid,data.allow_calls,data.relay_only?1:0);json(res,200,response(uid));return true;}
  }
  const match=url.pathname.match(/^\/api\/calls\/blocks\/(\d+)$/);
  if(match&&req.method==='POST'){const data=await body(req);auth(req);const peer=Number(match[1]);if(!Number.isSafeInteger(peer)||peer<1||peer===uid||!userById(peer)||typeof data.blocked!=='boolean')throw fail(400,'Некорректный собеседник');if(data.blocked){if(db.prepare('SELECT COUNT(*) n FROM call_blocks WHERE owner=?').get(uid).n>=500&&!db.prepare('SELECT 1 FROM call_blocks WHERE owner=? AND peer=?').get(uid,peer))throw fail(400,'До 500 исключений');db.prepare('INSERT OR IGNORE INTO call_blocks(owner,peer) VALUES(?,?)').run(uid,peer);onBlock(uid,peer);}else db.prepare('DELETE FROM call_blocks WHERE owner=? AND peer=?').run(uid,peer);json(res,200,response(uid));return true;}
  return false;
 }
 return {get,allowed,handle};
}
