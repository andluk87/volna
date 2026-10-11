export const FOLDER_LIMIT=20;
export const FOLDER_TYPES=['all','direct','contacts','non_contacts','group','channel','archived'];
export function defaultFolders(){return [['all','Все чаты'],['direct','Личные'],['group','Группы'],['channel','Каналы'],['unread','Непрочитанные'],['archived','Архив']].map(([rule,name])=>({id:'builtin_'+rule,name,chats:[],excluded:[],pinned:[],types:[],rule,excludeMuted:false,excludeRead:false,excludeArchived:false,icon:''}));}
const ids=a=>[...new Set((Array.isArray(a)?a:[]).filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,500);
export function normalizeFolders(value){
 if(!Array.isArray(value))return [];
 const seen=new Set();return value.slice(0,FOLDER_LIMIT).filter(f=>f&&typeof f.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(f.id)&&!seen.has(f.id)&&seen.add(f.id)&&typeof f.name==='string'&&f.name.trim()).map(f=>{
  const excluded=ids(f.excluded),pinned=ids(f.pinned).filter(id=>!excluded.includes(id));return {id:f.id,name:f.name.trim().slice(0,32),chats:ids(f.chats).filter(id=>!excluded.includes(id)),excluded,pinned,types:[...new Set((Array.isArray(f.types)?f.types:[]).filter(t=>FOLDER_TYPES.includes(t)))],rule:['all','direct','group','channel','unread','archived'].includes(f.rule)?f.rule:'',excludeMuted:f.excludeMuted===true,excludeRead:f.excludeRead===true,excludeArchived:f.excludeArchived===true,icon:typeof f.icon==='string'?f.icon.slice(0,12):''};
 });
}
function typeMatches(c,t){return t==='all'||t==='archived'&&!!c.archived||t==='direct'&&['direct','saved'].includes(c.kind)||t==='contacts'&&['direct','saved'].includes(c.kind)&&!!c.is_contact||t==='non_contacts'&&c.kind==='direct'&&!c.is_contact||t===c.kind;}
export function folderMatches(f,c){
 if(c.parent_id||f.excluded.includes(c.id))return false;
 if(f.chats.includes(c.id)||f.pinned.includes(c.id))return true;
 const legacy=f.rule&&(f.rule==='archived'?!!c.archived:!c.archived&&(f.rule==='all'||f.rule==='unread'&&c.unread>0||typeMatches(c,f.rule)));
 const automatic=legacy||f.types.some(t=>typeMatches(c,t));
 return !!automatic&&!(f.excludeMuted&&c.muted)&&!(f.excludeRead&&!(c.unread>0))&&!(f.excludeArchived&&c.archived);
}
export function folderChats(chats,f){const result=chats.filter(c=>folderMatches(f,c));return result.sort((a,b)=>{const x=f.pinned.indexOf(a.id),y=f.pinned.indexOf(b.id);return x<0&&y<0?0:x<0?1:y<0?-1:x-y;});}
