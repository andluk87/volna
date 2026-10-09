import React,{useEffect,useState} from 'react';
import {request,fileBlob} from './api';
function ExpressionTile({item,token,onPick}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let object;const c=new AbortController();fileBlob(item.attachment_id,token,c.signal).then(blob=>{object=URL.createObjectURL(blob);setUrl(object);}).catch(()=>{});return()=>{c.abort();if(object)URL.revokeObjectURL(object);};},[item.attachment_id,token]);
 return <button className="expression-tile" type="button" aria-label={'Отправить '+item.label} title={item.label} onClick={()=>onPick(item)}>{url?(item.mime.startsWith('video/')?<video src={url} muted autoPlay loop playsInline/>:<img src={url} alt={item.label} loading="lazy"/>):<span>{item.fallback||'…'}</span>}</button>;
}
export default function ExpressionPicker({kind,token,query,onPick}){
 const [items,setItems]=useState([]),[section,setSection]=useState('catalog'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[cursor,setCursor]=useState(0),[more,setMore]=useState(false);
 useEffect(()=>{const c=new AbortController();setBusy(true);setError('');setItems([]);const timer=setTimeout(()=>request(`/expressions?kind=${kind}&section=${section}&q=${encodeURIComponent(query)}`,token,undefined,c.signal).then(r=>{setItems(r.items);setCursor(r.next_offset);setMore(r.more);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);}),200);return()=>{clearTimeout(timer);c.abort();};},[kind,section,query,token,attempt]);
 async function next(){setBusy(true);try{const r=await request(`/expressions?kind=${kind}&section=${section}&q=${encodeURIComponent(query)}&offset=${cursor}`,token);setItems(i=>[...i,...r.items]);setMore(r.more);setCursor(r.next_offset);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><nav>{[['catalog','Все'],['recent','Недавние'],['favorite','Избранные']].map(([s,label])=><button type="button" key={s} className={section===s?'selected':''} onClick={()=>setSection(s)}>{label}</button>)}</nav><div className="expression-grid">{items.map(item=><ExpressionTile key={item.id} item={item} token={token} onPick={onPick}/>)}{busy&&<p role="status">Загрузка…</p>}{error&&<button type="button" onClick={()=>setAttempt(v=>v+1)}>Повторить: {error}</button>}{!busy&&!error&&!items.length&&<p>Ничего не найдено</p>}{more&&<button type="button" disabled={busy} onClick={next}>Показать ещё</button>}</div></>;
}
