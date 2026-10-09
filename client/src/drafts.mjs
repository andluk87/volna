import {boundaries} from '../../shared/emoji-text.mjs';
const prefix='volna.drafts.v1.';
const lifetime=7*24*60*60*1000;
const validEntities=(text,items)=>{const edges=boundaries(text);let end=0;return (Array.isArray(items)?items:[]).filter(e=>{if(!e||!/^[a-f0-9]{32}$/.test(e.id)||!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.length)||e.start<end||e.length<1||!edges.has(e.start)||!edges.has(e.start+e.length))return false;end=e.start+e.length;return true;}).slice(0,100).map(({id,start,length})=>({id,start,length}));};
const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0;
export function readDrafts(storage,userId,now=Date.now()){
 if(!validId(userId))return {};
 try{
  const stored=JSON.parse(storage.getItem(prefix+userId)||'{}'),result={};
  for(const [id,item] of Object.entries(stored)){
   if(validId(id)&&item&&typeof item.text==='string'&&item.text.trim()&&Number.isFinite(item.at)&&item.at<=now&&now-item.at<lifetime)
    {const text=item.text.slice(0,4000),entities=validEntities(text,item.entities);result[id]={text,file:null,reply:null,edit:null,...(entities.length?{entities}:{})};}
  }
  return result;
 }catch{return {};}
}
export function writeDrafts(storage,userId,drafts,now=Date.now()){
 if(!validId(userId))return false;
 try{
  const stored={};
  for(const [id,item] of Object.entries(drafts))if(validId(id)&&!item.edit&&typeof item.text==='string'&&item.text.trim()){const text=item.text.slice(0,4000),entities=validEntities(text,item.entities);stored[id]={text,at:now,...(entities.length?{entities}:{})};}
  if(Object.keys(stored).length)storage.setItem(prefix+userId,JSON.stringify(stored));
  else storage.removeItem(prefix+userId);
  return true;
 }catch{return false;}
}
export function clearDrafts(storage,userId){try{if(validId(userId))storage.removeItem(prefix+userId);}catch{}}
