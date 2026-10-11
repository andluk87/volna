import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
export function createNewsChannel({db,uploads}){
 db.exec(`CREATE TABLE IF NOT EXISTS official_news(id INTEGER PRIMARY KEY CHECK(id=1),user_id INTEGER NOT NULL,chat_id INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS news_enrolled(user_id INTEGER PRIMARY KEY REFERENCES users(id));`);
 let state=db.prepare('SELECT * FROM official_news WHERE id=1').get();
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!state){const suffix=randomBytes(6).toString('hex');const user=Number(db.prepare('INSERT INTO users(username,name,phone,admin_blocked,admin_reason) VALUES(?,?,?,?,?)').run('volna_news_'+suffix,'Волна — новости','news:'+suffix,1,'Служебный аккаунт канала: вход запрещён').lastInsertRowid);
   const chat=Number(db.prepare("INSERT INTO chats(pair,kind,title,description,created_by,posting_policy) VALUES(?,'channel',?,?,?,'admins')").run('official-volna-news','Волна — новости','🌊 Обновления и новости приложения. Коротко и по делу.',user).lastInsertRowid);
   db.prepare("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')").run(chat,user);db.prepare('INSERT INTO official_news(id,user_id,chat_id) VALUES(1,?,?)').run(user,chat);state={user_id:user,chat_id:chat};
  }
  mkdirSync(uploads,{recursive:true});
  for(const release of JSON.parse(readFileSync(new URL('./news/releases.json',import.meta.url),'utf8'))){
   const client='official-release:'+release.version;if(db.prepare('SELECT 1 FROM messages WHERE sender_id=? AND client_id=?').get(state.user_id,client))continue;
   const bytes=readFileSync(new URL('./news/'+basename(release.image),import.meta.url));const attachment=randomBytes(24).toString('hex');writeFileSync(join(uploads,attachment),bytes,{flag:'wx',mode:0o600});db.prepare('INSERT INTO attachments(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(attachment,state.user_id,'Волна '+release.version+'.jpg','image/jpeg',bytes.length,Date.now());
   db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at,attachment_id) VALUES(?,?,?,?,?,?)').run(state.chat_id,state.user_id,release.text,client,new Date().toISOString(),attachment);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const seen=new Set(db.prepare('SELECT user_id FROM news_enrolled').all().map(row=>row.user_id));
 function enroll(uid){if(uid===state.user_id||seen.has(uid))return;db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT OR IGNORE INTO members(chat_id,user_id,role) VALUES(?,?,'member')").run(state.chat_id,uid);db.prepare('INSERT OR IGNORE INTO news_enrolled(user_id) VALUES(?)').run(uid);db.exec('COMMIT');seen.add(uid);}catch(error){db.exec('ROLLBACK');throw error;}}
 for(const row of db.prepare('SELECT id FROM users WHERE admin_blocked=0').all())enroll(row.id);
 return {chatId:state.chat_id,enroll};
}
