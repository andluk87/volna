export const CHAT_ROW_HEIGHT=72;
export const SIDEBAR_STORAGE='volna.sidebar.folders.v1';
export {normalizeFolders,defaultFolders,folderMatches,FOLDER_TYPES,FOLDER_LIMIT} from '../../shared/folders.mjs';
import {folderChats} from '../../shared/folders.mjs';
export function chatsInFolder(chats,folders,id){const folder=folders.find(f=>f.id===id);return folder?folderChats(chats,folder):chats;}
