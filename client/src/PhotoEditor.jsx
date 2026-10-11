import Dialog from './Dialog';
import {preparePhoto} from './prepare-photo.mjs';
import React,{useEffect,useState} from 'react';
export default function PhotoEditor({file,onReady,onClose}){
 const [url,setUrl]=useState(''),[compressed,setCompressed]=useState(true),[rotation,setRotation]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const u=URL.createObjectURL(file);setUrl(u);return()=>URL.revokeObjectURL(u);},[file]);
 async function prepare(){setBusy(true);setError('');let bitmap;try{if(!compressed){if(file.size>20*1024*1024)throw Error('Оригинал больше 20 МБ');onReady(file);return;}onReady(await preparePhoto(file,rotation));}catch(e){setError(e.message||'Фото не поддерживается. Можно отправить оригинал файлом.');}finally{bitmap?.close();setBusy(false);}}
 return <Dialog title="Подготовка фото" heading="Отправить фото" closeLabel="Закрыть подготовку фото" className="photo-editor" onClose={()=>{if(!busy)onClose();}}><div className="photo-stage"><img src={url} alt="Предпросмотр фото" style={{transform:`rotate(${compressed?rotation:0}deg)`}}/></div><label><input type="checkbox" checked={compressed} disabled={busy} onChange={e=>setCompressed(e.target.checked)}/> Оптимизировать для чата (до 1600 px)</label><p>{compressed?'JPEG без исходных метаданных. Прозрачность заменяется белым фоном.':'Оригинал без изменений. Метаданные и качество сохраняются.'}</p>{compressed&&<button disabled={busy} onClick={()=>setRotation(v=>(v+90)%360)}>Повернуть на 90°</button>}{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={prepare}>{busy?'Обработка…':'Добавить к сообщению'}</button></Dialog>;
}
