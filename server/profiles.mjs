import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function profiles({db,uploads,auth,publish,userById,json,body}){
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='bio'))db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
  if(!columns.has('avatar_id'))db.exec('ALTER TABLE users ADD COLUMN avatar_id TEXT');
  if(!columns.has('avatar_hidden'))db.exec('ALTER TABLE users ADD COLUMN avatar_hidden INTEGER NOT NULL DEFAULT 0 CHECK(avatar_hidden IN (0,1))');
  if(db.prepare('PRAGMA user_version').get().user_version<7)db.exec('PRAGMA user_version=7');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return async(req,res,url,uid)=>{
  const match=url.pathname.match(/^\/api\/users\/(\d+)$/);
  if(match&&req.method==='GET'){
   const id=Number(match[1]);if(!Number.isSafeInteger(id))throw fail(404,'Пользователь не найден');
   const user=userById(id,id===uid);if(!user)throw fail(404,'Пользователь не найден');
   json(res,200,user);return true;
  }
  if(url.pathname!=='/api/profile'||req.method!=='POST')return false;
  const data=await body(req);auth(req);
  if(typeof data.name!=='string'||typeof data.bio!=='string')throw fail(400,'Укажите имя и описание текстом');
  const name=data.name.trim(),bio=data.bio.trim();
  if(!name||name.length>64||/[\u0000-\u001f\u007f]/.test(name))throw fail(400,'Имя: от 1 до 64 символов, без переносов строк');
  if(bio.length>280||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(bio))throw fail(400,'Описание: до 280 символов');
  if(data.avatar_id!==undefined){
   if(data.avatar_id!==null&&(typeof data.avatar_id!=='string'||!/^[a-f0-9]{48}$/.test(data.avatar_id)))throw fail(400,'Некорректное фото профиля');
   if(data.avatar_hidden!==undefined&&typeof data.avatar_hidden!=='boolean')throw fail(400,'Некорректное состояние фото профиля');
   if(data.avatar_id){
    const file=db.prepare('SELECT * FROM attachments WHERE id=? AND owner_id=?').get(data.avatar_id,uid);
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.mime)||file.size>5*1024*1024)throw fail(400,'Фото профиля: PNG, JPEG или WebP, до 5 МБ');
    let bytes;try{bytes=readFileSync(join(uploads,file.id));}catch{throw fail(404,'Фото отсутствует в хранилище');}
    const valid=file.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):file.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)throw fail(400,'Файл не является изображением указанного типа');
   }
   db.prepare('UPDATE users SET avatar_id=?,avatar_hidden=? WHERE id=?').run(data.avatar_id,data.avatar_hidden?1:0,uid);
  }
  db.prepare('UPDATE users SET name=?,bio=? WHERE id=?').run(name,bio,uid);
  const peers=db.prepare('SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.chat_id=b.chat_id WHERE a.user_id=?').all(uid).map(r=>r.user_id);
  publish([...new Set([uid,...peers])],{type:'profile',user_id:uid});
  json(res,200,userById(uid,true));return true;
 };
}
