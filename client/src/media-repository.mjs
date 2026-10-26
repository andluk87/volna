export const mediaKey=file=>file.mediaId||('m'+(file.message?.id||file.messageId||file.id));
export const isChatMedia=file=>/^(image|video)\//.test(file?.mime||'')&&!file.message?.expression&&!file.message?.deleted_at;
export function mergeMedia(...groups){const rows=new Map();for(const item of groups.flat())if(isChatMedia(item))rows.set(mediaKey(item),item);return [...rows.values()].sort((a,b)=>(a.message?.id||a.messageId||0)-(b.message?.id||b.messageId||0));}
/** Bounded session LRU. Auth token scopes cached bytes; nothing is stored in a shared HTTP cache. */
export class MediaCache{
 constructor(maxBytes=80*1024*1024){this.maxBytes=maxBytes;this.entries=new Map();this.bytes=0;}
 key(file,token){return token+'|'+mediaKey(file)+'|'+file.id;}
 get(file,token){const key=this.key(file,token),value=this.entries.get(key);if(value){this.entries.delete(key);this.entries.set(key,value);}return value;}
 put(file,token,blob){this.remove(file,token);if(blob.size>this.maxBytes)return;this.entries.set(this.key(file,token),blob);this.bytes+=blob.size;while(this.bytes>this.maxBytes){const [key,old]=this.entries.entries().next().value;this.entries.delete(key);this.bytes-=old.size;}}
 remove(file,token){const key=this.key(file,token),old=this.entries.get(key);if(old){this.bytes-=old.size;this.entries.delete(key);}}
 clear(token){for(const [key,blob] of this.entries)if(!token||key.startsWith(token+'|')){this.bytes-=blob.size;this.entries.delete(key);}}
}
export const mediaCache=new MediaCache();
