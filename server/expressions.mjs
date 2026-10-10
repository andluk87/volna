import {boundaries} from '../shared/emoji-text.mjs';
import {inspectEmojiPng} from './emoji-media.mjs';
import {emojiEngine} from './emoji-engine.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const idPattern=/^[a-f0-9]{32}$/;
const graphemes=new Intl.Segmenter('ru',{granularity:'grapheme'});

// Files stay in Volna storage. The server never fetches a user supplied URL.
export function expressions({db,uploads,body,json,member,publish}) {
 db.exec(`CREATE TABLE IF NOT EXISTS expression_packs(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,kind TEXT NOT NULL,public INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS expression_items(id TEXT PRIMARY KEY,pack_id TEXT NOT NULL REFERENCES expression_packs(id) ON DELETE CASCADE,attachment_id TEXT NOT NULL REFERENCES attachments(id),label TEXT NOT NULL,keywords TEXT NOT NULL,fallback TEXT NOT NULL,position INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS expression_installs(user_id INTEGER NOT NULL REFERENCES users(id),pack_id TEXT NOT NULL REFERENCES expression_packs(id) ON DELETE CASCADE,PRIMARY KEY(user_id,pack_id));
 CREATE TABLE IF NOT EXISTS expression_usage(user_id INTEGER NOT NULL REFERENCES users(id),item_id TEXT NOT NULL REFERENCES expression_items(id) ON DELETE CASCADE,used INTEGER NOT NULL DEFAULT 0,count INTEGER NOT NULL DEFAULT 0,favorite INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,item_id));
 CREATE INDEX IF NOT EXISTS expression_files ON expression_items(attachment_id);
 CREATE INDEX IF NOT EXISTS expression_pack_items ON expression_items(pack_id,position);`);
 if(!db.prepare('PRAGMA table_info(expression_packs)').all().some(c=>c.name==='builtin'))db.exec('ALTER TABLE expression_packs ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0');
 for(const name of ['client_id','fingerprint'])if(!db.prepare('PRAGMA table_info(expression_packs)').all().some(c=>c.name===name))db.exec(`ALTER TABLE expression_packs ADD COLUMN ${name} TEXT`);
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS expression_pack_nonce ON expression_packs(owner_id,client_id) WHERE client_id IS NOT NULL;');
 db.exec('CREATE TABLE IF NOT EXISTS expression_seeded(user_id INTEGER PRIMARY KEY REFERENCES users(id));');
 function seed(uid) {
  if(db.prepare('SELECT 1 FROM expression_seeded WHERE user_id=?').get(uid))return;
  const root=fileURLToPath(new URL('./assets/expressions/',import.meta.url));
  const items=JSON.parse(readFileSync(join(root,'catalog.json'),'utf8'));
  db.exec('BEGIN IMMEDIATE');const written=[];
  try {
   for(const [index,kind] of ['sticker','gif'].entries()) {
    const packId='0000000000000000000000000000000'+(index+1);
    if(!db.prepare('SELECT 1 FROM expression_packs WHERE id=?').get(packId)) {
     db.prepare('INSERT INTO expression_packs(id,owner_id,title,kind,public,created,builtin) VALUES(?,?,?,?,1,?,1)').run(packId,uid,kind==='gif'?'Волна · GIF':'Волна · эмоции',kind,Date.now());
     let position=0;
     for(const item of items.filter(i=>i.kind===kind)) {
      const bytes=readFileSync(join(root,item.file)),fileId=randomBytes(24).toString('hex');
      writeFileSync(join(uploads,fileId),bytes,{flag:'wx',mode:0o600});written.push(fileId);
      db.prepare('INSERT INTO attachments(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(fileId,uid,item.file,item.mime,bytes.length,Date.now());
      db.prepare('INSERT INTO expression_items VALUES(?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),packId,fileId,item.label,item.keywords.join('|'),'✨',position++);
     }
    }
    db.prepare('INSERT OR IGNORE INTO expression_installs VALUES(?,?)').run(uid,packId);
   }
   db.prepare('INSERT INTO expression_seeded VALUES(?)').run(uid);db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK');for(const id of written){try{unlinkSync(join(uploads,id));}catch{}}throw e; }
 }
 const accessible=(pack,uid)=>pack&&!['blocked','deleted'].includes(pack.status)&&(pack.public===1||pack.owner_id===uid);
 const getItem=(id,uid)=>{
  const row=db.prepare('SELECT i.*,p.kind,p.title AS pack_title,p.public,p.status,p.owner_id,a.name,a.mime,a.size FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id JOIN attachments a ON a.id=i.attachment_id WHERE i.id=?').get(id);
  if(!accessible(row,uid))throw fail(404,'Элемент набора недоступен');return row;
 };
 const hydrate=(row,uid)=>({...row,public:!!row.public,owner_id:undefined,keywords:row.keywords.split('|'),favorite:!!row.favorite,url:`/api/files/${row.attachment_id}`});
 const pack=(row,uid)=>({...row,public:!!row.public,own:row.owner_id===uid&&!row.builtin,owner_id:undefined,client_id:undefined,fingerprint:undefined,installed:!!db.prepare('SELECT 1 FROM expression_installs WHERE user_id=? AND pack_id=?').get(uid,row.id),items:db.prepare('SELECT i.*,a.name,a.mime,a.size,COALESCE(u.favorite,0) AS favorite FROM expression_items i JOIN attachments a ON a.id=i.attachment_id LEFT JOIN expression_usage u ON u.item_id=i.id AND u.user_id=? WHERE i.pack_id=? ORDER BY i.position').all(uid,row.id).map(i=>hydrate({...i,kind:row.kind,pack_title:row.title,public:row.public},uid))});
 const usage=(uid,id,used,favorite)=>{
  getItem(id,uid);
  db.prepare('INSERT OR IGNORE INTO expression_usage(user_id,item_id) VALUES(?,?)').run(uid,id);
  if(used)db.prepare('UPDATE expression_usage SET used=?,count=count+1 WHERE user_id=? AND item_id=?').run(Date.now(),uid,id);
  if(favorite!==undefined)db.prepare('UPDATE expression_usage SET favorite=? WHERE user_id=? AND item_id=?').run(favorite?1:0,uid,id);
 };
 function fileAccessible(id,uid) {
  return !!db.prepare('SELECT 1 FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id WHERE i.attachment_id=? AND (p.public=1 OR p.owner_id=?) LIMIT 1').get(id,uid)
   || !!db.prepare('SELECT 1 FROM message_emoji e JOIN messages m ON m.id=e.message_id JOIN members c ON c.chat_id=m.chat_id WHERE e.attachment_id=? AND m.deleted_at IS NULL AND c.user_id=? LIMIT 1').get(id,uid);
 }
 function fileUsed(id) {return !!db.prepare('SELECT 1 FROM expression_items WHERE attachment_id=? LIMIT 1').get(id)||!!db.prepare('SELECT 1 FROM message_emoji WHERE attachment_id=? LIMIT 1').get(id);}
 function entities(text,value,uid,forward=false,retained=new Set()) {
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.length>100)throw fail(400,'Слишком много пользовательских эмодзи');
  let end=0;const edges=boundaries(text);
  return value.map(e=>{
   if(!e||!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.length)||e.start<end||e.length<1||e.length>32||e.start+e.length>text.length||typeof e.id!=='string'||!idPattern.test(e.id))throw fail(400,'Некорректные пользовательские эмодзи');
   const row=forward||retained.has(e.id)?db.prepare('SELECT i.*,p.kind,a.mime FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id JOIN attachments a ON a.id=i.attachment_id WHERE i.id=?').get(e.id):getItem(e.id,uid);
   if(!edges.has(e.start)||!edges.has(e.start+e.length))throw fail(400,'Эмодзи должен совпадать с целой Unicode-графемой');
   if(!row||row.kind!=='emoji'||text.slice(e.start,e.start+e.length)!==row.fallback)throw fail(400,'Эмодзи не соответствует тексту');
   end=e.start+e.length;return {id:e.id,start:e.start,length:e.length,attachment_id:row.attachment_id,mime:row.mime};
  });
 }
 const recordEntities=(messageId,items)=>{db.prepare('DELETE FROM message_emoji WHERE message_id=?').run(messageId);for(const e of items)db.prepare('INSERT INTO message_emoji VALUES(?,?,?,?,?)').run(messageId,e.id,e.start,e.length,e.attachment_id);};
 db.exec('CREATE TABLE IF NOT EXISTS message_emoji(message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,item_id TEXT NOT NULL,start INTEGER NOT NULL,length INTEGER NOT NULL,attachment_id TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(message_id,start)); CREATE INDEX IF NOT EXISTS message_emoji_files ON message_emoji(attachment_id);');
 const hydrateEntities=id=>db.prepare("SELECT e.item_id AS id,e.start,e.length,CASE WHEN p.status='blocked' THEN NULL ELSE e.attachment_id END AS attachment_id,a.mime FROM message_emoji e JOIN attachments a ON a.id=e.attachment_id LEFT JOIN expression_items i ON i.id=e.item_id LEFT JOIN expression_packs p ON p.id=i.pack_id WHERE e.message_id=? ORDER BY e.start").all(id);
 const blockedFile=id=>!!db.prepare("SELECT 1 FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id WHERE i.attachment_id=? AND p.status='blocked' LIMIT 1").get(id);
 const engine=emojiEngine({db,uploads,body,json,getItem,pack,usage,publish});
 async function handle(req,res,url,uid) {
  let path=url.pathname;const method=req.method;
  if(await engine.handle(req,res,url,uid))return true;
  const canonicalCreate=path==='/api/v1/emoji/packs'&&method==='POST';
  if(canonicalCreate){const d=await body(req);if(d.kind&&d.kind!=='emoji'||!Array.isArray(d.items)||d.items.length>engine.maximum)throw fail(400,'Некорректный набор эмодзи');for(const item of d.items){const f=db.prepare('SELECT * FROM attachments WHERE id=? AND owner_id=?').get(item?.attachment_id||'',uid);if(!f||f.mime!=='image/png')throw fail(400,'Нужен PNG 100×100');inspectEmojiPng(readFileSync(join(uploads,f.id)),{exact:true});}if(d.description!==undefined&&(typeof d.description!=='string'||d.description.length>500))throw fail(400,'Описание до 500 символов');req.volnaParsedBody={...d,kind:'emoji',public:d.visibility?d.visibility==='public':d.public===true};path='/api/expressions/packs';}
  if(path.startsWith('/api/expressions'))seed(uid);
  if(path==='/api/expressions/packs'&&method==='GET') {
   const q=(url.searchParams.get('q')||'').trim().slice(0,100).toLocaleLowerCase('ru');
   const rows=db.prepare("SELECT p.* FROM expression_packs p WHERE p.status='published' AND (p.public=1 OR p.owner_id=?) AND instr(casefold(p.title),?)>0 ORDER BY p.owner_id=? DESC,p.created DESC LIMIT 100").all(uid,q,uid);
   json(res,200,rows.map(p=>pack(p,uid)));return true;
  }
  if(path==='/api/expressions'&&method==='GET') {
   const kind=url.searchParams.get('kind')||'sticker',section=url.searchParams.get('section')||'catalog',q=(url.searchParams.get('q')||'').trim().slice(0,100).toLocaleLowerCase('ru');
   const offset=Number(url.searchParams.get('offset')||0);
   if(!['sticker','gif','emoji'].includes(kind)||!['catalog','recent','favorite','installed'].includes(section)||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw fail(400,'Некорректный фильтр каталога');
   const filters={catalog:'1=1',recent:'u.used>0',favorite:'u.favorite=1',installed:'EXISTS(SELECT 1 FROM expression_installs s WHERE s.user_id=u.user_id AND s.pack_id=p.id)'};
   const rows=db.prepare(`SELECT i.*,p.kind,p.title AS pack_title,p.public,a.name,a.mime,a.size,u.favorite,u.used,u.count FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id JOIN attachments a ON a.id=i.attachment_id LEFT JOIN expression_usage u ON u.item_id=i.id AND u.user_id=? WHERE p.status='published' AND p.kind=? AND (p.public=1 OR p.owner_id=?) AND (${section==='installed'?'EXISTS(SELECT 1 FROM expression_installs s WHERE s.user_id=? AND s.pack_id=p.id)':filters[section]}) AND (instr(casefold(i.label||' '||i.keywords||' '||p.title),?)>0 OR i.fallback=?) ORDER BY ${section==='recent'?'u.used DESC':'p.created DESC,i.position'} LIMIT 61 OFFSET ?`).all(...[uid,kind,uid,...(section==='installed'?[uid]:[]),q,q,offset]);
   json(res,200,{items:rows.slice(0,60).map(r=>hydrate(r,uid)),more:rows.length>60,next_offset:offset+Math.min(rows.length,60)});return true;
  }
  if(path==='/api/expressions/packs'&&method==='POST') {
   const data=await body(req),title=typeof data.title==='string'?data.title.trim():'';
   if(!title||title.length>64||/[\u0000-\u001f]/.test(title)||!['sticker','gif','emoji'].includes(data.kind)||typeof data.public!=='boolean'||!Array.isArray(data.items)||data.items.length<1||data.items.length>(data.kind==='emoji'?engine.maximum:100))throw fail(400,'Некорректное название или превышен лимит элементов набора');
   if(data.client_id!==undefined&&(typeof data.client_id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(data.client_id)))throw fail(400,'Некорректный идентификатор набора');
   const fingerprint=createHash('sha256').update(JSON.stringify({title,kind:data.kind,public:data.public,items:data.items,...(canonicalCreate?{description:data.description||''}:{})})).digest('hex');
   const previous=data.client_id?db.prepare('SELECT * FROM expression_packs WHERE owner_id=? AND client_id=?').get(uid,data.client_id):null;
   if(previous){if(previous.fingerprint!==fingerprint)throw fail(409,'Идентификатор набора уже использован');json(res,200,pack(previous,uid));return true;}
   if(db.prepare('SELECT COUNT(*) AS n FROM expression_packs WHERE owner_id=? AND builtin=0').get(uid).n>=50)throw fail(400,'Максимум 50 собственных наборов');
   const ids=new Set();
   const items=data.items.map((item,index)=>{
    if(!item||typeof item.attachment_id!=='string'||ids.has(item.attachment_id))throw fail(400,'Файлы набора должны быть разными');ids.add(item.attachment_id);
    const file=db.prepare('SELECT * FROM attachments WHERE id=? AND owner_id=?').get(item.attachment_id,uid);
    if(!file||file.size<=0||file.size>10*1024*1024||!['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(file.mime))throw fail(400,'Элемент: изображение или видео до 10 МБ');
    if(data.kind==='gif'&&!['image/gif','image/webp','video/mp4','video/webm'].includes(file.mime))throw fail(400,'GIF-набор: GIF, анимированный WebP, MP4 или WebM');
    const bytes=readFileSync(join(uploads,file.id)),valid=file.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):file.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':file.mime==='image/gif'?['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)):file.mime==='video/webm'?bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')):bytes.toString('ascii',4,8)==='ftyp';
    if(data.kind==='emoji'){if(file.mime!=='image/png')throw fail(400,'Emoji MVP принимает статичный PNG; WebP преобразуйте в PNG');inspectEmojiPng(bytes);}
    if(!valid)throw fail(400,'Содержимое элемента не соответствует типу файла');
    const label=typeof item.label==='string'?item.label.trim().slice(0,64):file.name.slice(0,64),keywords=Array.isArray(item.keywords)?item.keywords.filter(k=>typeof k==='string').slice(0,20).map(k=>k.slice(0,40)).join('|'):'';
    const fallback=typeof item.fallback==='string'?item.fallback:'✨';
    if(fallback.length>32||[...graphemes.segment(fallback)].length!==1||!/^(?:\p{Regional_Indicator}{2}|[0-9#*]\ufe0f?\u20e3|\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\u{e0020}-\u{e007f}]*)$/u.test(fallback))throw fail(400,'Укажите один обычный эмодзи для совместимости');
    return {id:randomBytes(16).toString('hex'),attachment:file.id,label,keywords,fallback,position:index};
   });
   const id=randomBytes(16).toString('hex');db.exec('BEGIN IMMEDIATE');
   try {db.prepare('INSERT INTO expression_packs(id,owner_id,title,kind,public,created,client_id,fingerprint) VALUES(?,?,?,?,?,?,?,?)').run(id,uid,title,data.kind,data.public?1:0,Date.now(),data.client_id||null,fingerprint);for(const i of items)db.prepare('INSERT INTO expression_items VALUES(?,?,?,?,?,?,?)').run(i.id,id,i.attachment,i.label,i.keywords,i.fallback,i.position);db.prepare('INSERT INTO expression_installs VALUES(?,?)').run(uid,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   if(canonicalCreate){db.prepare('UPDATE expression_packs SET description=?,slug=?,updated=? WHERE id=?').run(data.description||'','pack-'+id,Date.now(),id);}publish?.([uid],{type:'emoji_pack.updated',pack_id:id});json(res,201,pack(db.prepare('SELECT * FROM expression_packs WHERE id=?').get(id),uid));return true;
  }
  const match=path.match(/^\/api\/expressions\/packs\/([a-f0-9]{32})(?:\/(install|remove))?$/);
  if(match) {
   const p=db.prepare('SELECT * FROM expression_packs WHERE id=?').get(match[1]);if(!accessible(p,uid))throw fail(404,'Набор недоступен');
   if(method==='GET'&&!match[2]){json(res,200,pack(p,uid));return true;}
   if(method==='POST'&&match[2]) {if(match[2]==='install'){db.prepare('INSERT OR IGNORE INTO expression_installs VALUES(?,?)').run(uid,p.id);}else db.prepare('DELETE FROM expression_installs WHERE user_id=? AND pack_id=?').run(uid,p.id);json(res,200,{ok:true});return true;}
  }
  const item=path.match(/^\/api\/expressions\/([a-f0-9]{32})\/favorite$/);
  if(item&&method==='POST') {const data=await body(req);if(typeof data.active!=='boolean')throw fail(400,'Укажите состояние избранного');usage(uid,item[1],false,data.active);json(res,200,{ok:true});return true;}
  return false;
 }
 return {handle,getItem,usage,fileUsed,fileAccessible,entities,recordEntities,hydrateEntities,blockedFile};
}
