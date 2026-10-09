import {readFileSync} from 'node:fs';import {join} from 'node:path';
const fail=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
export const reservedUsernames=new Set('admin administrator root support help volna api app auth login logout register settings profile users groups topics download downloads assets icons static public index landing offline sw manifest robots favicon health www mail ftp server moderator system bot notifications security privacy terms'.split(' '));
export function canonicalUsername(value){return typeof value==='string'?value.trim().replace(/^@/,'').toLowerCase():'';}
export function usernameProblem(value,{allowNumeric=false}={}){
 if(!/^[a-z0-9_]{4,32}$/.test(value))return 'От 4 до 32 символов: латинские буквы, цифры и _';
 if(!allowNumeric&&/^\d+$/.test(value))return 'Для собственного ника добавьте латинскую букву или _';
 if(reservedUsernames.has(value))return 'Этот username зарезервирован';return null;
}
export function availablePhoneUsername(db,phone){const base=phone.replace(/\D/g,'');let value=base,i=0;while(db.prepare('SELECT 1 FROM users WHERE lower(username)=?').get(value))value=base+'_'+(++i);return value;}
export function usernames({db,body,json,userById,publish,uploads,publicBase=process.env.PUBLIC_BASE_URL||'https://volna.lknet.ru'}){
 const origin=new URL(publicBase);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error('PUBLIC_BASE_URL requires HTTPS');const base=origin.href.replace(/\/$/,'');
 db.exec('BEGIN IMMEDIATE');try{
 const cols=new Set(db.prepare('PRAGMA table_info(users)').all().map(x=>x.name));
 for(const [name,type] of Object.entries({username_normalized:'TEXT',created_at:'TEXT',updated_at:'TEXT'}))if(!cols.has(name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
 // Replace only the previous release's generated aliases. Existing chosen names remain intact.
 if(!db.prepare("SELECT 1 FROM auth_settings WHERE key='phone-usernames-v1'").get()) {for(const row of db.prepare('SELECT id,username,phone FROM users').all())if(/^u[a-f0-9]{16}$/.test(row.username))db.prepare('UPDATE users SET username=? WHERE id=?').run(availablePhoneUsername(db,row.phone),row.id);db.prepare('INSERT INTO auth_settings VALUES(?,?)').run('phone-usernames-v1','done');}
 db.exec(`UPDATE users SET username_normalized=lower(username),created_at=COALESCE(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=COALESCE(updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 CREATE UNIQUE INDEX IF NOT EXISTS users_username_normalized ON users(username_normalized);
 CREATE TRIGGER IF NOT EXISTS user_profile_timestamp AFTER UPDATE OF name,bio,avatar_id,avatar_hidden ON users BEGIN UPDATE users SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS username_insert AFTER INSERT ON users BEGIN UPDATE users SET username_normalized=lower(NEW.username),created_at=COALESCE(NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=COALESCE(NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS username_update AFTER UPDATE OF username ON users BEGIN UPDATE users SET username_normalized=lower(NEW.username),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END; COMMIT;`);
 }catch(e){db.exec('ROLLBACK');throw e;}
 const decorate=user=>user&&({...user,display_username:'@'+user.username,profile_url:base+'/'+user.username});
 const free=(nick,uid)=>!reservedUsernames.has(nick)&&!db.prepare('SELECT 1 FROM users WHERE username_normalized=? AND id<>?').get(nick,uid);
 function suggestions(nick,uid){const out=[];for(let i=1;out.length<5&&i<10000;i++){const suffix=i===1?'1':i===2?'24':i===3?'_01':i===4?'_volna':'_'+i;const candidate=nick.slice(0,32-suffix.length)+suffix;if(!usernameProblem(candidate)&&free(candidate,uid)&&!out.includes(candidate))out.push(candidate);}return out;}
 function check(value,uid){const username=canonicalUsername(value),own=userById(uid);const reason=usernameProblem(username,{allowNumeric:own?.username===username});if(reason)return {available:false,valid:false,username,reason,suggestions:reservedUsernames.has(username)?suggestions(username,uid):[]};const available=free(username,uid);return {available,valid:true,username,...(!available?{suggestions:suggestions(username,uid)}:{})};}
 function search(raw,uid){const q=String(raw||'').trim().slice(0,100),nick=canonicalUsername(q);if(nick.length<2)return [];
 // A formatted full international number is an exact match, never a phone-prefix directory.
 const digits=q.replace(/[+\s().-]/g,''),isPhone=!q.startsWith('@')&&/^[+0-9\s().-]+$/.test(q);if(isPhone&&!/^[1-9][0-9]{7,14}$/.test(digits))return [];
 const rows=isPhone?db.prepare('SELECT id FROM users WHERE phone=? AND id<>?').all('+'+digits,uid):db.prepare(`SELECT id FROM users WHERE id<>? AND (instr(username_normalized,?)=1 OR instr(casefold(name),casefold(?))>0 OR CAST(id AS TEXT)=?) ORDER BY CASE WHEN username_normalized=? THEN 0 WHEN instr(username_normalized,?)=1 THEN 1 ELSE 2 END,username_normalized LIMIT 30`).all(uid,nick,nick,nick,nick,nick);
 return rows.map(({id})=>decorate(userById(id)));
 }
 async function publicHandle(req,res,url){const m=url.pathname.match(/^\/api\/public\/users\/([a-zA-Z0-9_]{4,32})(\/avatar)?$/);if(!m||req.method!=='GET')return false;
 const row=db.prepare('SELECT id,avatar_id,avatar_hidden FROM users WHERE username_normalized=?').get(m[1].toLowerCase());if(!row)throw fail(404,'Профиль не найден');
 if(m[2]){if(row.avatar_hidden||!row.avatar_id)throw fail(404,'Фото не найдено');const file=db.prepare('SELECT mime FROM attachments WHERE id=?').get(row.avatar_id);if(!file||!['image/png','image/jpeg','image/webp'].includes(file.mime))throw fail(404,'Фото не найдено');const data=readFileSync(join(uploads,row.avatar_id));res.writeHead(200,{'Content-Type':file.mime,'Content-Length':data.length});res.end(data);}
 else{const user=decorate(userById(row.id));user.avatar_url=row.avatar_hidden||!row.avatar_id?null:`/api/public/users/${user.username}/avatar`;delete user.online;json(res,200,user);}return true;
 }
 async function handle(req,res,url,uid){const path=url.pathname;
 if(path==='/api/users/username/check'&&req.method==='GET'){json(res,200,check(url.searchParams.get('username'),uid));return true;}
 if(path==='/api/users/me/username'&&['PATCH','POST'].includes(req.method)){
 const data=await body(req),result=check(data.username,uid);if(!result.valid)throw fail(400,result.reason,{suggestions:result.suggestions});if(!result.available)throw fail(409,'Этот username уже занят',{suggestions:result.suggestions});
 try{db.prepare('UPDATE users SET username=? WHERE id=?').run(result.username,uid);}catch(e){if(e.code==='ERR_SQLITE_ERROR'&&String(e.message).includes('UNIQUE'))throw fail(409,'Этот username уже занят',{suggestions:suggestions(result.username,uid)});throw e;}
 const user=decorate(userById(uid,true));const peers=db.prepare('SELECT DISTINCT peer.user_id FROM members m JOIN members peer ON peer.chat_id=m.chat_id WHERE m.user_id=?').all(uid).map(r=>r.user_id);publish([...new Set([uid,...peers])],{type:'profile',user_id:uid,user:decorate(userById(uid))});json(res,200,{success:true,username:user.username,display_username:user.display_username,profile_url:user.profile_url,user});return true;
 }
 if(['/api/users','/api/users/search'].includes(path)&&req.method==='GET'){const users=search(url.searchParams.get('q'),uid);json(res,200,path.endsWith('/search')?{users}:users);return true;}
 return false;
 }
 return {handle,publicHandle,decorate};
}
