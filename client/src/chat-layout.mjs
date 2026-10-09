/** Pure view helpers shared by the live client, demo and tests. */
export function filterChats(chats,filter='all',query='',includeArchived=false){
 const q=query.trim().toLocaleLowerCase('ru');
 return chats.filter(c=>!c.parent_id&&(!q?(filter==='archived'?c.archived:includeArchived||!c.archived):true)&&(filter==='unread'?c.unread>0:filter==='direct'?c.kind==='direct'||c.saved:filter==='groups'?c.kind==='group':filter==='channels'?c.kind==='channel':true)&&(!q||(c.name+' '+(c.username||'')).toLocaleLowerCase('ru').includes(q))).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(b.last_at||'').localeCompare(String(a.last_at||''))||a.id-b.id);
}
export function adjacentMessage(previous,current){return !!previous&&!!current&&!previous.deleted_at&&!current.deleted_at&&previous.sender_id===current.sender_id&&previous.created_at.slice(0,10)===current.created_at.slice(0,10)&&Math.abs(new Date(current.created_at)-new Date(previous.created_at))<300000&&!current.forwarded_name&&!current.reply;}
export function dateLabel(value,now=new Date()){
 const date=new Date(value),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(date.getFullYear(),date.getMonth(),date.getDate());
 if(+day===+today)return 'Сегодня';const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);if(+day===+yesterday)return 'Вчера';
 return date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});
}
export function mediaKind(m){const mime=m.attachment?.mime||'';return mime.startsWith('audio/')?'voice':mime.startsWith('image/')||mime.startsWith('video/')?'media':m.attachment?'files':/https?:\/\//.test(m.text||'')?'links':'text';}
