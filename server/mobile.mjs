const fail=(status,message)=>Object.assign(new Error(message),{status});

// Access-token metadata; refresh ownership defines active device sessions.
export function mobile({db,auth,body,json,userById,disconnect,online}) {
  db.exec(`CREATE TABLE IF NOT EXISTS session_details(
    token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,
    agent TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_details_seen ON session_details(last_seen);`);
  const touch=(req,session)=>{
    const now=Date.now(),agent=String(req.headers['user-agent']||'Неизвестное устройство').replace(/[\x00-\x1f\x7f]/g,'').slice(0,160);
    db.prepare(`INSERT INTO session_details VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET
      last_seen=excluded.last_seen WHERE session_details.last_seen<?`).run(session.token,agent,now,now,now-30000);
  };
  const describe=agent=>agent.includes('VolnaAndroid/')?'Волна · Android':/Android/i.test(agent)?'Браузер · Android':/Windows/i.test(agent)?'Windows':/iPhone|iPad/i.test(agent)?'iOS':/Macintosh/i.test(agent)?'macOS':/Linux/i.test(agent)?'Linux':agent||'Неизвестное устройство';
  const handle=async(req,res,url,session)=>{
    const uid=session.user_id,path=url.pathname;
    if(path==='/api/contacts'&&req.method==='GET') {
      const ids=db.prepare(`SELECT DISTINCT u.id FROM users u JOIN members peer ON peer.user_id=u.id
        JOIN members me ON me.chat_id=peer.chat_id AND me.user_id=?
        JOIN chats c ON c.id=me.chat_id AND c.kind='direct' WHERE u.id<>? ORDER BY u.name,u.id`).all(uid,uid);
      json(res,200,ids.map(({id})=>({...userById(id),online:online(id)})));return true;
    }
    if(path==='/api/sessions'&&req.method==='GET') {
      json(res,200,db.prepare(`SELECT s.token AS id,r.expires,r.platform,d.agent,d.created,d.last_seen FROM sessions s
        JOIN refresh_sessions r ON r.access_id=s.token LEFT JOIN session_details d ON d.token=s.token WHERE s.user_id=? AND r.expires>? ORDER BY d.last_seen DESC`).all(uid,Date.now())
        .map(row=>({id:row.id,current:row.id===session.token,label:row.platform==='android'?'Волна · Android':row.platform==='windows'?'Волна · Windows':describe(row.agent),platform:row.platform,browser:row.agent,created:row.created??null,last_seen:row.last_seen??null,expires:row.expires})));
      return true;
    }
    const revoke=path.match(/^\/api\/sessions\/([a-f0-9]{64}|others)\/revoke$/);
    if(revoke&&req.method==='POST') {
      await body(req);auth(req);
      const ids=revoke[1]==='others'?db.prepare('SELECT token FROM sessions WHERE user_id=? AND token<>?').all(uid,session.token).map(row=>row.token):[revoke[1]];
      if(revoke[1]===session.token)throw fail(400,'Для текущего устройства используйте выход из аккаунта');
      for(const id of ids) {
        // An opaque hash is only a revocation id, never a bearer token.
        const removed=db.prepare('DELETE FROM sessions WHERE user_id=? AND token=?').run(uid,id);
        if(removed.changes)disconnect(uid,id);
      }
      json(res,200,{ok:true});return true;
    }
    return false;
  };
  return {handle,touch};
}
