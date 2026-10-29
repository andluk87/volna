const fail=(status,message)=>Object.assign(new Error(message),{status});
export function profilePosts({db,auth,body,json,userById,publish}){
 db.exec(`CREATE TABLE IF NOT EXISTS profile_posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,text TEXT NOT NULL,attachment_id TEXT REFERENCES attachments(id),
  created INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id,client_id));CREATE INDEX IF NOT EXISTS profile_posts_owner ON profile_posts(user_id,archived,id);CREATE INDEX IF NOT EXISTS profile_posts_attachment ON profile_posts(attachment_id) WHERE deleted=0;`);
 const view=row=>({...row,attachment:row.attachment_id?db.prepare('SELECT id,name,mime,size FROM attachments WHERE id=? AND admin_blocked=0').get(row.attachment_id)||null:null});
 const notify=uid=>publish([uid],{type:'profile-posts',user_id:uid});
 return async(req,res,url,uid)=>{
  const list=url.pathname.match(/^\/api\/users\/(\d+)\/posts$/);
  if(list&&req.method==='GET'){
   const owner=Number(list[1]),archive=url.searchParams.get('archive')==='1',before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
   if(!Number.isSafeInteger(before)||before<1)throw fail(400,'Некорректный курсор');
   if(archive&&owner!==uid)throw fail(403,'Архив доступен только владельцу');
   if(!userById(owner)||db.prepare('SELECT admin_blocked FROM users WHERE id=?').get(owner)?.admin_blocked)throw fail(404,'Профиль недоступен');
   json(res,200,db.prepare('SELECT p.* FROM profile_posts p WHERE p.user_id=? AND p.archived=? AND p.deleted=0 AND p.id<? AND (p.attachment_id IS NULL OR EXISTS(SELECT 1 FROM attachments a WHERE a.id=p.attachment_id AND a.admin_blocked=0)) ORDER BY p.id DESC LIMIT 30').all(owner,archive?1:0,before).map(view));return true;
  }
  if(url.pathname==='/api/posts'&&req.method==='POST'){
   const data=await body(req);auth(req);if(data.text!==undefined&&typeof data.text!=='string')throw fail(400,'Некорректный текст');const text=typeof data.text==='string'?data.text.trim():'',file=data.attachment_id??null;
   if(typeof data.client_id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(data.client_id)||text.length>4000||(!text&&!file))throw fail(400,'Введите текст до 4000 символов или выберите фото/видео');
   if(file!==null&&(typeof file!=='string'||!/^[a-f0-9]{48}$/.test(file)))throw fail(400,'Некорректное вложение');
   const old=db.prepare('SELECT * FROM profile_posts WHERE user_id=? AND client_id=?').get(uid,data.client_id);
   if(old){if(old.text!==text||old.attachment_id!==file)throw fail(409,'Идентификатор уже использован');if(old.deleted)throw fail(409,'Публикация уже удалена');json(res,200,view(old));return true;}
   if(file){const attachment=db.prepare('SELECT * FROM attachments WHERE id=? AND owner_id=? AND admin_blocked=0').get(file,uid);
    if(!attachment||!/^image\/(jpeg|png|webp)$|^video\/(mp4|webm)$/.test(attachment.mime)||attachment.size>20*1024*1024)throw fail(400,'Фото или видео до 20 МБ');
    if(db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(file)||db.prepare('SELECT 1 FROM users WHERE avatar_id=?').get(file)||db.prepare('SELECT 1 FROM profile_posts WHERE attachment_id=? AND deleted=0').get(file))throw fail(409,'Файл уже используется');
   }
   if(db.prepare('SELECT COUNT(*) n FROM profile_posts WHERE user_id=? AND created>?').get(uid,Date.now()-3600000).n>=20)throw fail(429,'До 20 публикаций в час');
   const id=db.prepare('INSERT INTO profile_posts(user_id,client_id,text,attachment_id,created) VALUES(?,?,?,?,?)').run(uid,data.client_id,text,file,Date.now()).lastInsertRowid;
   notify(uid);json(res,201,view(db.prepare('SELECT * FROM profile_posts WHERE id=?').get(id)));return true;
  }
  const action=url.pathname.match(/^\/api\/posts\/(\d+)\/(archive|delete)$/);
  if(action&&req.method==='POST'){
   const data=await body(req);auth(req);const row=db.prepare('SELECT * FROM profile_posts WHERE id=? AND user_id=? AND deleted=0').get(Number(action[1]),uid);if(!row)throw fail(404,'Публикация недоступна');
   if(action[2]==='archive'){if(typeof data.archived!=='boolean')throw fail(400,'Укажите состояние архива');db.prepare('UPDATE profile_posts SET archived=? WHERE id=?').run(data.archived?1:0,row.id);}
   else db.prepare('UPDATE profile_posts SET deleted=1,attachment_id=NULL,text=\'\' WHERE id=?').run(row.id);
   notify(uid);json(res,200,{ok:true});return true;
  }
  return false;
 };
}
