import {isEmoji} from '../shared/emoji-text.mjs';
import {mkdirSync, writeFileSync, readFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
const error=(status,message)=>Object.assign(new Error(message),{status});
const emojis=['👍','❤️','😂','🔥','🎉','😢','👏','😍','🤔','😮','🙏','💯','👎','🥰','🤣','😎','😭','🤝','💪','👋','✨','💙','😡','🤗'];
const maxFile=20*1024*1024, quota=200*1024*1024;
export function messaging({db,uploads,member,broadcast,userById,json,body,transcriber,expressions=()=>null}) {
  mkdirSync(uploads,{recursive:true});
  // Additive migration: safe for the original 0.1 database and repeated starts.
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(x=>x.name));
    for(const [name,type] of Object.entries({expression_id:'TEXT',album_id:'TEXT',attachment_id:'TEXT',reply_to:'INTEGER',edited_at:'TEXT',deleted_at:'TEXT',forwarded_name:'TEXT',forward_source:'INTEGER',transcript:'TEXT'}))
      if(!columns.has(name))db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
    db.exec(`CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reactions(message_id INTEGER NOT NULL REFERENCES messages(id),user_id INTEGER NOT NULL REFERENCES users(id),emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id,emoji));
      CREATE TABLE IF NOT EXISTS pins(chat_id INTEGER NOT NULL REFERENCES chats(id),message_id INTEGER NOT NULL REFERENCES messages(id),PRIMARY KEY(chat_id,message_id));
      CREATE INDEX IF NOT EXISTS messages_album ON messages(album_id);
      CREATE INDEX IF NOT EXISTS messages_attachment ON messages(attachment_id);
      COMMIT;`);
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(db.prepare('PRAGMA user_version').get().user_version<6)db.exec('PRAGMA user_version=6');
  db.function('casefold',{deterministic:true},value=>String(value||'').toLocaleLowerCase('ru-RU'));
  const permission=(chat,uid)=>{
    member(chat,uid);
    return db.prepare('SELECT c.kind,c.posting_policy,c.topic_closed,m.role FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=? AND m.user_id=?').get(chat,uid);
  };
  const canPublish=(chat,uid)=>{const c=permission(chat,uid);if(c.topic_closed)throw error(403,'Подтема закрыта');if((c.kind==='channel'||c.kind==='group'&&c.posting_policy==='admins')&&!['admin','owner'].includes(c.role))throw error(403,'Публиковать могут только администраторы');return c;};
  const canModerate=(chat,uid)=>{const c=permission(chat,uid);return ['group','channel'].includes(c.kind)&&['admin','owner'].includes(c.role);};
  const get=id=>db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  const hydrate=row=>{
    if(!row)return null;
    const topic=db.prepare("SELECT c.parent_id,c.title,(SELECT title FROM chats WHERE id=c.parent_id) AS group_title FROM chats c WHERE c.id=?").get(row.chat_id);row={...row,group_id:topic?.parent_id||row.chat_id,topic_id:topic?.parent_id?row.chat_id:null,topic_name:topic?.parent_id?topic.title:null,group_name:topic?.parent_id?topic.group_title:topic?.title||null};
    if(row.deleted_at)return {...row,text:'',attachment_id:null,expression_id:null,emoji_entities:[],reply_to:null,forwarded_name:null,attachment:null,reply:null,reactions:[],pinned:false};
    const reply=row.reply_to?get(row.reply_to):null;
    return {...row,emoji_entities:expressions()?.hydrateEntities(row.id)||[],expression:row.expression_id?db.prepare('SELECT i.id,i.pack_id,p.kind FROM expression_items i JOIN expression_packs p ON p.id=i.pack_id WHERE i.id=?').get(row.expression_id):null,sender_name:userById(row.sender_id)?.name||'Пользователь',attachment:row.attachment_id?db.prepare('SELECT id,name,mime,size FROM attachments WHERE id=?').get(row.attachment_id):null,
      reply:reply?{id:reply.id,sender_id:reply.sender_id,name:userById(reply.sender_id)?.name,text:reply.deleted_at?'Сообщение удалено':reply.text||'Вложение',deleted:!!reply.deleted_at}:null,
      reactions:db.prepare('SELECT r.emoji,r.user_id,u.name FROM reactions r JOIN users u ON u.id=r.user_id WHERE r.message_id=? ORDER BY r.emoji,r.user_id').all(row.id),
      pinned:!!db.prepare('SELECT 1 FROM pins WHERE message_id=?').get(row.id)};
  };
  const changed=(row,extra={})=>broadcast(row.chat_id,{type:'message-update',message:hydrate(row),...extra});
  const authorized=(id,uid)=>{const row=get(id);if(!row)throw error(404,'Сообщение не найдено');member(row.chat_id,uid);return row;};
  const clientId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(value))throw error(400,'Некорректный идентификатор сообщения');return value;};
  function insert(chat,uid,data){
    canPublish(chat,uid);
    const cid=clientId(data.client_id),rawText=String(data.text||''),text=rawText.trim(),reply=data.reply_to||null,source=data.forward_source||null;
    if(data.expression_id&&(typeof data.expression_id!=='string'||!/^[a-f0-9]{32}$/.test(data.expression_id)))throw error(400,'Некорректный элемент набора');
    const expression=data.expression_id?expressions()?.getItem(data.expression_id,uid):null;
    if(expression?.kind==='emoji')throw error(400,'Пользовательский эмодзи вставляется в текст');
    const attachment=expression?.attachment_id||data.attachment_id||null;
    const shift=rawText.length-rawText.trimStart().length;
    if(data.emoji_entities!==undefined&&!Array.isArray(data.emoji_entities))throw error(400,'Некорректные пользовательские эмодзи');
    const entities=expressions()?.entities(text,data.emoji_entities?.map(e=>({...e,start:e?.start-shift})),uid,!!source)||[];
    if(attachment&&(typeof attachment!=='string'||!/^[a-f0-9]{48}$/.test(attachment)))throw error(400,'Некорректный файл');
    if(reply&&(!Number.isSafeInteger(reply)||reply<1))throw error(400,'Некорректный ответ');
    const existing=db.prepare('SELECT * FROM messages WHERE sender_id=? AND client_id=?').get(uid,cid);
    if(existing){if(existing.chat_id!==chat||existing.forward_source!==source||(!source&&(existing.text!==text||existing.attachment_id!==attachment||existing.reply_to!==reply||existing.expression_id!==(expression?.id||null)||JSON.stringify(expressions()?.hydrateEntities(existing.id)||[])!==JSON.stringify(entities))))throw error(409,'Идентификатор уже использован');return {row:existing,created:false};}
    if(text.length>4000||(!text&&!attachment))throw error(400,'Введите текст до 4000 символов или прикрепите файл');
    if(reply){const quoted=get(reply);if(!quoted||quoted.chat_id!==chat||quoted.deleted_at)throw error(400,'Сообщение для ответа недоступно');}
    if(attachment){const file=db.prepare('SELECT * FROM attachments WHERE id=?').get(attachment);
      if(!file)throw error(404,'Файл не найден');
      if(!source&&!expression&&(file.owner_id!==uid||db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(attachment)))throw error(403,'Файл уже отправлен или принадлежит другому пользователю');
    }
    const result=db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at,attachment_id,reply_to,forwarded_name,forward_source,expression_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(chat,uid,text,cid,new Date().toISOString(),attachment,reply,data.forwarded_name||null,source,expression?.id||data.forward_expression_id||null);
    const messageId=Number(result.lastInsertRowid);
    expressions()?.recordEntities(messageId,entities);
    if(expression)expressions()?.usage(uid,expression.id,true);
    if(!source)for(const id of new Set(entities.map(e=>e.id)))expressions()?.usage(uid,id,true);
    return {row:get(messageId),created:true};
  }
  const cleanupUnused=()=>{
    const unused=db.prepare('SELECT id FROM attachments WHERE created_at<? AND NOT EXISTS (SELECT 1 FROM messages WHERE attachment_id=attachments.id) AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_id=attachments.id)').all(Date.now()-86400000);
    for(const file of unused){if(expressions()?.fileUsed(file.id))continue;try{unlinkSync(join(uploads,file.id));}catch(e){if(e.code!=='ENOENT')continue;}db.prepare('DELETE FROM attachments WHERE id=?').run(file.id);}
  };
  cleanupUnused();
  let uploadCount=0;
  const pendingTranscriptions=new Map();let activeTranscriptions=0;
  return async(req,res,url,uid)=>{
    const path=url.pathname,method=req.method;
    if(path==='/api/search/messages'&&method==='GET'){
      const q=(url.searchParams.get('q')||'').trim().slice(0,200),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
      if(!Number.isSafeInteger(before)||before<1)throw error(400,'Некорректный курсор');
      const rows=q.length<2?[]:db.prepare(`SELECT m.* FROM messages m JOIN members c ON c.chat_id=m.chat_id
        WHERE c.user_id=? AND m.id<? AND m.deleted_at IS NULL AND instr(casefold(m.text),casefold(?))>0
        ORDER BY m.id DESC LIMIT 50`).all(uid,before,q);
      json(res,200,rows.map(hydrate));return true;
    }
    if(path==='/api/uploads'&&method==='POST'){
      if(uploadCount>=4)throw error(429,'Загрузки заняты, попробуйте ещё раз');
      const size=Number(req.headers['content-length']);if(size>maxFile)throw error(413,'Максимальный размер файла — 20 МБ');
      let name;try{name=decodeURIComponent(String(req.headers['x-file-name']||'file'));}catch{throw error(400,'Некорректное имя файла');}
      name=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)||'file';
      const given=String(req.headers['content-type']||'').split(';')[0];
      const mime=/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(webm|ogg|mpeg|mp4|wav))$/.test(given)?given:'application/octet-stream';
      uploadCount++;
      try{
        let total=0;const chunks=[];
        for await(const chunk of req){total+=chunk.length;if(total>maxFile)throw error(413,'Максимальный размер файла — 20 МБ');chunks.push(chunk);}
        if(!total)throw error(400,'Файл пуст');
        cleanupUnused();
        const used=db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM attachments WHERE owner_id=?').get(uid).size;
        if(used+total>quota)throw error(413,'Лимит хранилища аккаунта — 200 МБ');
        const id=randomBytes(24).toString('hex');writeFileSync(join(uploads,id),Buffer.concat(chunks),{flag:'wx',mode:0o600});
        try{db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run(id,uid,name,mime,total,Date.now());}
        catch(e){unlinkSync(join(uploads,id));throw e;}
        json(res,201,{id,name,mime,size:total});return true;
      }finally{uploadCount--;}
    }
    const discard=path.match(/^\/api\/uploads\/([a-f0-9]{48})\/discard$/);
    if(discard&&method==='POST'){
      const file=db.prepare('SELECT * FROM attachments WHERE id=? AND owner_id=?').get(discard[1],uid);
      if(!file)throw error(404,'Файл не найден');
      if(db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(file.id)||db.prepare('SELECT 1 FROM users WHERE avatar_id=?').get(file.id)||expressions()?.fileUsed(file.id))throw error(409,'Файл уже используется');
      try{unlinkSync(join(uploads,file.id));}catch(e){if(e.code!=='ENOENT')throw e;}
      db.prepare('DELETE FROM attachments WHERE id=?').run(file.id);json(res,200,{ok:true});return true;
    }
    const fileMatch=path.match(/^\/api\/files\/([a-f0-9]{48})$/);
    if(fileMatch&&method==='GET'){
      const id=fileMatch[1],file=db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
      const attached=db.prepare('SELECT 1 FROM messages WHERE attachment_id=?').get(id);
      const accessible=db.prepare('SELECT 1 FROM messages m JOIN members c ON c.chat_id=m.chat_id WHERE m.attachment_id=? AND m.deleted_at IS NULL AND c.user_id=? LIMIT 1').get(id,uid);
      const avatar=db.prepare('SELECT 1 FROM users WHERE avatar_id=? AND avatar_hidden=0').get(id);
      if(expressions()?.blockedFile(id))throw error(404,'Эмодзи заблокирован');
      if(!file||(!accessible&&!avatar&&!expressions()?.fileAccessible(id,uid)&&!(file.owner_id===uid&&!attached)))throw error(404,'Файл недоступен');
      let bytes;try{bytes=readFileSync(join(uploads,id));}catch{throw error(404,'Файл отсутствует в хранилище');}
      res.writeHead(200,{'Content-Type':file.mime,'Content-Length':bytes.length,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Content-Security-Policy':"default-src 'none'; sandbox"});res.end(bytes);return true;
    }
    if(path==='/api/saved'&&method==='POST'){
      const pair='saved:'+uid;db.prepare('INSERT OR IGNORE INTO chats(pair) VALUES(?)').run(pair);const chat=db.prepare('SELECT id FROM chats WHERE pair=?').get(pair);
      db.prepare("UPDATE chats SET kind='saved' WHERE id=?").run(chat.id);
      db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').run(chat.id,uid);json(res,200,chat);return true;
    }
    if(path==='/api/chats'&&method==='GET'){
      const rows=db.prepare(`SELECT c.id,me.last_read,COALESCE(other.last_read,me.last_read) AS peer_read,COALESCE(u.id,?) AS peer_id,
        CASE WHEN c.pair LIKE 'saved:%' THEN 'Избранное' ELSE u.name END AS name,COALESCE(u.username,'saved') AS username,
        CASE WHEN c.pair LIKE 'saved:%' THEN 1 ELSE 0 END AS saved,
        (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'Сообщение удалено' WHEN text='' THEN '📎 Вложение' ELSE text END FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_text,
        (SELECT created_at FROM messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND id>me.last_read AND sender_id<>? AND deleted_at IS NULL) AS unread
        FROM chats c JOIN members me ON me.chat_id=c.id AND me.user_id=? LEFT JOIN members other ON other.chat_id=c.id AND other.user_id<>?
        LEFT JOIN users u ON u.id=other.user_id ORDER BY saved DESC,COALESCE(last_at,'') DESC,c.id DESC`).all(uid,uid,uid,uid);
      json(res,200,rows);return true;
    }
    const album=path.match(/^\/api\/chats\/(\d+)\/album$/);
    if(album&&method==='POST'){
      const chat=Number(album[1]),data=await body(req);canPublish(chat,uid);
      const cid=clientId(data.client_id),ids=data.attachment_ids,rawText=String(data.text||''),text=rawText.trim(),reply=data.reply_to||null;
      if(cid.length>48||!Array.isArray(ids)||ids.length<2||ids.length>10||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id)))throw error(400,'Альбом: от 2 до 10 разных фото или видео');
      if(data.emoji_entities!==undefined&&!Array.isArray(data.emoji_entities))throw error(400,'Некорректные пользовательские эмодзи');const shift=rawText.length-rawText.trimStart().length,emoji=expressions()?.entities(text,data.emoji_entities?.map(e=>({...e,start:e?.start-shift})),uid)||[];
      const key=uid+':'+cid,previous=db.prepare('SELECT * FROM messages WHERE album_id=? ORDER BY id').all(key);
      if(previous.length){
        if(JSON.stringify(expressions()?.hydrateEntities(previous[0].id)||[])!==JSON.stringify(emoji)||previous.length!==ids.length||previous.some((m,i)=>m.chat_id!==chat||m.attachment_id!==ids[i]||m.text!==(i===0?text:'')||m.reply_to!==reply))throw error(409,'Идентификатор альбома уже использован');
        json(res,200,previous.map(hydrate));return true;
      }
      const rows=[];db.exec('BEGIN IMMEDIATE');
      try{
        for(let i=0;i<ids.length;i++){
          const file=db.prepare('SELECT mime FROM attachments WHERE id=?').get(ids[i]);
          if(!file||!file.mime.match(/^(image|video)\//))throw error(400,'В альбоме могут быть только фото и видео');
          const result=insert(chat,uid,{client_id:cid+'-'+i,text:i===0?rawText:'',emoji_entities:i===0?data.emoji_entities:[],attachment_id:ids[i],reply_to:reply});
          if(!result.created)throw error(409,'Идентификатор уже использован');
          db.prepare('UPDATE messages SET album_id=? WHERE id=?').run(key,result.row.id);rows.push(get(result.row.id));
        }
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      const result=rows.map(hydrate);for(const message of result)broadcast(chat,{type:'message',message});json(res,201,result);return true;
    }
    const messages=path.match(/^\/api\/chats\/(\d+)\/(messages|pins|search|media)$/);
    if(messages){
      const chat=Number(messages[1]),action=messages[2];member(chat,uid);
      if(method==='GET'){
        let rows;
        if(action==='pins')rows=db.prepare('SELECT m.* FROM messages m JOIN pins p ON p.message_id=m.id WHERE p.chat_id=? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 20').all(chat);
        else{
          const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)throw error(400,'Некорректный курсор');
          if(action==='media'){
            const type=url.searchParams.get('type')||'all';
            const filters={all:'m.attachment_id IS NOT NULL',media:"(a.mime LIKE 'image/%' OR a.mime LIKE 'video/%')",files:"a.mime NOT LIKE 'image/%' AND a.mime NOT LIKE 'video/%' AND a.mime NOT LIKE 'audio/%'",voice:"a.mime LIKE 'audio/%'",animations:"a.mime IN ('image/gif','image/webp')",links:"(instr(m.text,'https://')>0 OR instr(m.text,'http://')>0)"};
            if(!Object.hasOwn(filters,type))throw error(400,'Неизвестный тип медиа');
            rows=db.prepare(`SELECT m.* FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id WHERE m.chat_id=? AND m.id<? AND m.deleted_at IS NULL AND (${filters[type]}) ORDER BY m.id DESC LIMIT 50`).all(chat,before);
          }
          else if(action==='search'){
            const q=(url.searchParams.get('q')||'').trim().slice(0,200);
            rows=q?db.prepare('SELECT m.* FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id WHERE m.chat_id=? AND m.id<? AND m.deleted_at IS NULL AND (instr(casefold(m.text),casefold(?))>0 OR instr(casefold(COALESCE(a.name,\'\')),casefold(?))>0) ORDER BY m.id DESC LIMIT 50').all(chat,before,q,q):[];
          }else if(url.searchParams.has('around')){
            const around=Number(url.searchParams.get('around'));
            if(!Number.isSafeInteger(around)||around<1||!db.prepare('SELECT 1 FROM messages WHERE id=? AND chat_id=?').get(around,chat))throw error(404,'Сообщение не найдено');
            rows=[...db.prepare('SELECT * FROM messages WHERE chat_id=? AND id<=? ORDER BY id DESC LIMIT 25').all(chat,around).reverse(),...db.prepare('SELECT * FROM messages WHERE chat_id=? AND id>? ORDER BY id LIMIT 25').all(chat,around)];
          }else rows=db.prepare('SELECT * FROM messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 50').all(chat,before).reverse();
        }
        json(res,200,rows.map(hydrate));return true;
      }
      if(action==='messages'&&method==='POST'){
        const data=await body(req);const result=insert(chat,uid,{text:data.text,client_id:data.client_id,attachment_id:data.attachment_id,reply_to:data.reply_to,expression_id:data.expression_id,emoji_entities:data.emoji_entities});
        const message=hydrate(result.row);if(result.created)broadcast(chat,{type:'message',message});json(res,result.created?201:200,message);return true;
      }
    }
    const messageMatch=path.match(/^\/api\/messages\/(\d+)(?:\/(edit|delete|react|pin|forward|transcribe))?$/);
    if(messageMatch){
      let row=authorized(Number(messageMatch[1]),uid);const action=messageMatch[2];
      if(method==='GET'&&!action){json(res,200,hydrate(row));return true;}
      if(method!=='POST')return false;
      if(action==='transcribe'){
        if(row.deleted_at)throw error(410,'Сообщение удалено');
        if(!row.attachment_id)throw error(400,'В сообщении нет аудио');
        const file=db.prepare('SELECT * FROM attachments WHERE id=?').get(row.attachment_id);
        if(!file||!file.mime.startsWith('audio/')||!file.name.startsWith('Голосовое-'))throw error(400,'Распознавание доступно только для голосовых сообщений');
        if(row.transcript){json(res,200,{transcript:row.transcript});return true;}
        if(!transcriber)throw error(503,'Распознавание на сервере не настроено');
        let job=pendingTranscriptions.get(row.id);
        if(!job){
          if(activeTranscriptions>=2)throw error(429,'Сейчас распознаются другие сообщения. Попробуйте через минуту');
          activeTranscriptions++;
          job=(async()=>{
            try{
              const bytes=readFileSync(join(uploads,file.id));
              const transcript=await transcriber({bytes,name:file.name,mime:file.mime});
              const latest=get(row.id);if(!latest||latest.deleted_at)throw error(410,'Сообщение удалено');
              db.prepare('UPDATE messages SET transcript=? WHERE id=?').run(transcript,row.id);
              const updated=get(row.id);changed(updated);return transcript;
            }finally{activeTranscriptions--;pendingTranscriptions.delete(row.id);}
          })();
          pendingTranscriptions.set(row.id,job);
        }
        const transcript=await job;json(res,200,{transcript});return true;
      }
      const data=await body(req);
      row=authorized(Number(messageMatch[1]),uid);
      if(row.deleted_at){if(action==='delete'&&(row.sender_id===uid||canModerate(row.chat_id,uid))){json(res,200,hydrate(row));return true;}throw error(410,'Сообщение удалено');}
      let reactionEvent;
      if(action==='edit'){
        canPublish(row.chat_id,uid);
        if(row.sender_id!==uid)throw error(403,'Можно изменять только свои сообщения');
        const text=String(data.text||'').trim();if(text.length>4000||(!text&&!row.attachment_id))throw error(400,'Введите текст до 4000 символов');
        const shift=String(data.text||'').length-String(data.text||'').trimStart().length;
        if(data.emoji_entities!==undefined&&!Array.isArray(data.emoji_entities))throw error(400,'Некорректные пользовательские эмодзи');
        const entities=expressions()?.entities(text,data.emoji_entities?.map(e=>({...e,start:e?.start-shift})),uid,false,new Set((expressions()?.hydrateEntities(row.id)||[]).map(e=>e.id)))||[];
        db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE messages SET text=?,edited_at=? WHERE id=?').run(text,new Date().toISOString(),row.id);expressions()?.recordEntities(row.id,entities);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      }else if(action==='delete'){
        if(row.sender_id!==uid&&!canModerate(row.chat_id,uid))throw error(403,'Можно удалять только свои сообщения');
        db.exec('BEGIN IMMEDIATE');try{
          db.prepare('UPDATE messages SET text=\'\',transcript=NULL,deleted_at=? WHERE id=?').run(new Date().toISOString(),row.id);
          expressions()?.recordEntities(row.id,[]);
          db.prepare('DELETE FROM reactions WHERE message_id=?').run(row.id);db.prepare('DELETE FROM pins WHERE message_id=?').run(row.id);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        if(row.attachment_id&&!expressions()?.fileUsed(row.attachment_id)&&!db.prepare('SELECT 1 FROM messages WHERE attachment_id=? AND deleted_at IS NULL').get(row.attachment_id)&&!db.prepare('SELECT 1 FROM users WHERE avatar_id=?').get(row.attachment_id)){
          try{unlinkSync(join(uploads,row.attachment_id));}catch(e){if(e.code!=='ENOENT')console.error('Attachment cleanup failed',e.code);}
          db.prepare('UPDATE attachments SET size=0 WHERE id=?').run(row.attachment_id);
        }
      }else if(action==='react'){
        if(!isEmoji(data.emoji)||typeof data.active!=='boolean')throw error(400,'Некорректная реакция');
        if(data.active&&!db.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').get(row.id,uid,data.emoji)){const userMax=Math.max(1,Math.min(20,Number(process.env.EMOJI_REACTIONS_PER_USER)||3)),messageMax=Math.max(1,Math.min(100,Number(process.env.EMOJI_REACTION_TYPES)||20));if(db.prepare('SELECT count(*) n FROM reactions WHERE message_id=? AND user_id=?').get(row.id,uid).n>=userMax)throw error(400,'Достигнут лимит реакций пользователя');if(!db.prepare('SELECT 1 FROM reactions WHERE message_id=? AND emoji=?').get(row.id,data.emoji)&&db.prepare('SELECT count(DISTINCT emoji) n FROM reactions WHERE message_id=?').get(row.id).n>=messageMax)throw error(400,'Достигнут лимит типов реакций');}const result=data.active?db.prepare('INSERT OR IGNORE INTO reactions VALUES(?,?,?)').run(row.id,uid,data.emoji):db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').run(row.id,uid,data.emoji);
        if(result.changes)reactionEvent={user_id:uid,emoji:data.emoji,active:data.active};
      }else if(action==='pin'){
        const permissions=permission(row.chat_id,uid);if(['group','channel'].includes(permissions.kind)&&!['admin','owner'].includes(permissions.role))throw error(403,'Закреплять могут только администраторы');
        if(typeof data.pinned!=='boolean')throw error(400,'Укажите pinned');
        if(data.pinned){if(db.prepare('SELECT COUNT(*) AS n FROM pins WHERE chat_id=?').get(row.chat_id).n>=20&&!db.prepare('SELECT 1 FROM pins WHERE message_id=?').get(row.id))throw error(400,'Максимум 20 закреплений');db.prepare('INSERT OR IGNORE INTO pins VALUES(?,?)').run(row.chat_id,row.id);}
        else db.prepare('DELETE FROM pins WHERE message_id=?').run(row.id);
      }else if(action==='forward'){
        const chat=Number(data.chat_id);member(chat,uid);
        const result=insert(chat,uid,{text:row.text,attachment_id:row.attachment_id,forwarded_name:row.forwarded_name||userById(row.sender_id).name,forward_source:row.id,client_id:data.client_id,emoji_entities:expressions()?.hydrateEntities(row.id),forward_expression_id:row.expression_id});
        const message=hydrate(result.row);if(result.created)broadcast(chat,{type:'message',message});json(res,result.created?201:200,message);return true;
      }else return false;
      const updated=get(row.id);changed(updated,reactionEvent?{reaction:reactionEvent}:{});json(res,200,hydrate(updated));return true;
    }
    return false;
  };
}
