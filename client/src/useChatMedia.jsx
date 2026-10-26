import {useEffect,useRef,useState} from 'react';
import {mediaKey,mergeMedia} from './media-repository.mjs';
export default function useChatMedia(file,gallery,token,actions){
 const [items,setItems]=useState(()=>mergeMedia(gallery,file)),[key,setKey]=useState(mediaKey(file)),[page,setPage]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,retry]=useState(0);
 const pending=useRef(new Set()),controllers=useRef(new Set()),removed=useRef(new Set()),pageRef=useRef(page),itemsRef=useRef(items),keyRef=useRef(key);pageRef.current=page;itemsRef.current=items;keyRef.current=key;
 function remove(messageId){const target='m'+messageId;removed.current.add(target);setItems(rows=>{const at=rows.findIndex(f=>mediaKey(f)===target);if(at<0)return rows;const next=rows.filter(f=>mediaKey(f)!==target);if(keyRef.current===target)setKey(mediaKey(next[Math.min(at,next.length-1)]||file));return next;});}
 async function load(direction='around'){
  if(file.viewerStandalone||!(file.message?.id||file.messageId)||!actions?.mediaPage||pending.current.has(direction))return;
  const state=pageRef.current;if(direction!=='around'&&(!state||!state[direction==='before'?'hasMoreBefore':'hasMoreAfter']))return;
  pending.current.add(direction);setLoading(true);const controller=new AbortController();controllers.current.add(controller);
  try{const anchor=itemsRef.current.find(f=>mediaKey(f)===keyRef.current)||file;const result=await actions.mediaPage(anchor,{direction,cursor:direction==='around'?null:state[direction+'Cursor']},controller.signal);if(controller.signal.aborted)return;
   const files=result.items.map(row=>({...row.message.attachment,mediaId:row.mediaId,message:row.message})).filter(f=>!removed.current.has(mediaKey(f)));
   setItems(rows=>direction==='around'?files:mergeMedia(rows,files));
   setPage(old=>direction==='around'?result:{...old,[direction+'Cursor']:result[direction+'Cursor'],[direction==='before'?'hasMoreBefore':'hasMoreAfter']:result[direction==='before'?'hasMoreBefore':'hasMoreAfter']});setError('');
  }catch(e){if(e.name==='AbortError')return;if([401,403,404].includes(e.status)){setItems([]);actions.onUnavailable?.();}setError(e.message);}
  finally{controllers.current.delete(controller);pending.current.delete(direction);if(!controller.signal.aborted)setLoading(pending.current.size>0);}
 }
 useEffect(()=>{load();return()=>{for(const c of controllers.current)c.abort();pending.current.clear();};},[file.messageId,file.message?.id,file.id,token,attempt]);
 useEffect(()=>{const event=e=>{const value=e.detail;if(value.type==='emoji_asset.unavailable'){for(const f of itemsRef.current)if(f.id===value.attachment_id)remove(f.message?.id||f.messageId);return;}if(value.message){const m=value.message;if(m.chat_id!==(file.message?.chat_id||itemsRef.current.find(f=>f.message)?.message.chat_id))return;if(m.deleted_at)remove(m.id);else if(m.attachment&&!m.expression)setItems(rows=>{if(!rows.some(f=>f.message?.id===m.id)&&pageRef.current?.hasMoreAfter)return rows;const next=mergeMedia(rows,{...m.attachment,message:m});return next;});}else if(['removed','history-cleared'].includes(value.type)&&value.chat_id===(file.message?.chat_id||itemsRef.current.find(f=>f.message)?.message.chat_id)){setItems([]);actions.onUnavailable?.();setError('Доступ к истории изменился. Откройте медиа заново.');}};window.addEventListener('volna-media-event',event);return()=>window.removeEventListener('volna-media-event',event);},[token,file.id]);
 useEffect(()=>{const focus=()=>{if(document.visibilityState==='visible')load('around');};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[token]);
 const index=items.findIndex(item=>mediaKey(item)===key),current=items[index]||null;
 useEffect(()=>{if(index<0||!page)return;if(index<5)load('before');if(index>=items.length-5)load('after');},[index,items.length,page?.beforeCursor,page?.afterCursor]);
 return {items,current,index,setKey,page,loading,error,retry:()=>retry(v=>v+1),remove};
}
