export const CHAT_ROW_HEIGHT=72;
export const SIDEBAR_STORAGE='volna.sidebar.folders.v1';
/** Explicitly configured local folders; no folder bar for a new installation. */
export function normalizeFolders(value){
 if(!Array.isArray(value))return [];
 const ids=new Set();return value.slice(0,12).filter(f=>f&&typeof f.id==='string'&&/^folder-[a-z0-9-]+$/.test(f.id)&&!ids.has(f.id)&&ids.add(f.id)&&typeof f.name==='string'&&f.name.trim()).map(f=>({id:f.id,name:f.name.trim().slice(0,32),chats:[...new Set((Array.isArray(f.chats)?f.chats:[]).filter(Number.isSafeInteger))].slice(0,500)}));
}
export function chatsInFolder(chats,folders,id){const folder=folders.find(f=>f.id===id);return folder?chats.filter(c=>folder.chats.includes(c.id)):chats;}
