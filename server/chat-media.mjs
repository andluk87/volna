import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
/** A cursor is scoped to one user, chat, filter and direction. Never grants file access. */
export function chatMedia({db,hydrate,member,cutoff}){
 const secret=randomBytes(32);
 db.exec('CREATE INDEX IF NOT EXISTS messages_chat_media ON messages(chat_id,id) WHERE attachment_id IS NOT NULL AND deleted_at IS NULL');
 function cursor(data){const payload=Buffer.from(JSON.stringify({...data,expires:Date.now()+86400000})).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');}
 function decode(value){try{if(value.length>1024)throw 0;const [payload,signature,...rest]=value.split('.'),wanted=createHmac('sha256',secret).update(payload).digest(),given=Buffer.from(signature||'','base64url');if(rest.length||given.length!==wanted.length||!timingSafeEqual(given,wanted))throw 0;const data=JSON.parse(Buffer.from(payload,'base64url'));if(data.expires<Date.now()||!Number.isSafeInteger(data.id)||data.id<1)throw 0;return data;}catch{throw fail(400,'Курсор медиа устарел или повреждён');}}
 return (chat,uid,params)=>{
  member(chat,uid);const hidden=cutoff(chat,uid),type=params.get('type')||'photo_video',limit=Number(params.get('limit')||40);
  if(!['photo','video','photo_video'].includes(type)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw fail(400,'Некорректный фильтр или размер страницы');
  const filter=type==='photo'?"a.mime LIKE 'image/%'":type==='video'?"a.mime LIKE 'video/%'":"(a.mime LIKE 'image/%' OR a.mime LIKE 'video/%')";
  const base=`FROM messages m JOIN attachments a ON a.id=m.attachment_id WHERE m.chat_id=? AND m.id>? AND m.deleted_at IS NULL AND m.expression_id IS NULL AND COALESCE(a.admin_blocked,0)=0 AND (${filter})`;
  let direction=params.get('direction')||'around',anchor=params.get('anchorMediaId'),id;
  if(params.has('cursor')){const data=decode(params.get('cursor'));if(data.chat!==chat||data.uid!==uid||data.type!==type)throw fail(400,'Курсор относится к другому просмотру');id=data.id;direction=data.direction;if(params.has('direction')&&params.get('direction')!==direction)throw fail(400,'Неверное направление курсора');}
  else if(anchor){if(!/^m[1-9]\d*$/.test(anchor))throw fail(400,'Некорректное медиа');id=Number(anchor.slice(1));if(!Number.isSafeInteger(id)||!db.prepare(`SELECT m.id ${base} AND m.id=?`).get(chat,hidden,id))throw fail(404,'Медиа недоступно');}
  if(!['before','after','around'].includes(direction)||direction!=='around'&&!id)throw fail(400,'Укажите опорное медиа или курсор');
  const query=(comparison,order,count,value)=>db.prepare(`SELECT m.* ${base} ${comparison} ORDER BY m.id ${order} LIMIT ?`).all(chat,hidden,...(value===undefined?[]:[value]),count);
  let rows;
  if(direction==='around'&&id){const left=Math.floor((limit-1)/2);rows=[...query('AND m.id<?','DESC',left,id).reverse(),...query('AND m.id>=?','ASC',limit-left,id)];}
  else if(direction==='around')rows=query('','DESC',limit).reverse();
  else rows=query(direction==='before'?'AND m.id<?':'AND m.id>?',direction==='before'?'DESC':'ASC',limit,id);if(direction==='before')rows.reverse();
  const first=rows[0]?.id,last=rows.at(-1)?.id;
  const hasMoreBefore=!!(first&&db.prepare(`SELECT 1 ${base} AND m.id<? LIMIT 1`).get(chat,hidden,first)),hasMoreAfter=!!(last&&db.prepare(`SELECT 1 ${base} AND m.id>? LIMIT 1`).get(chat,hidden,last));
  return {items:rows.map(row=>{const message=hydrate(row,uid),file=message.attachment;return {mediaId:'m'+row.id,chatId:chat,messageId:row.id,albumId:row.album_id,type:file.mime.startsWith('video/')?'video':'photo',senderId:row.sender_id,senderName:message.sender_name,createdAt:row.created_at,positionInAlbum:row.album_id?db.prepare('SELECT COUNT(*) AS n FROM messages WHERE album_id=? AND id<?').get(row.album_id,row.id).n:0,thumbnailUrl:`/api/files/${file.id}?message_id=${row.id}`,fullUrl:`/api/files/${file.id}?message_id=${row.id}`,width:null,height:null,caption:row.text,isDeleted:false,message};}),beforeCursor:hasMoreBefore?cursor({chat,uid,type,id:first,direction:'before'}):null,afterCursor:hasMoreAfter?cursor({chat,uid,type,id:last,direction:'after'}):null,hasMoreBefore,hasMoreAfter};
 };
}
