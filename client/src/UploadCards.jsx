import React,{useEffect,useState} from 'react';
import {Icon} from './ui';
import {uploadSize} from './upload-transport.mjs';
import './uploads.css';
export function LocalAttachment({file}){const [url,setUrl]=useState('');useEffect(()=>{if(!file.raw)return;const value=URL.createObjectURL(file.raw);setUrl(value);return()=>URL.revokeObjectURL(value);},[file.raw]);return <span className="local-attachment">{file.mime.startsWith('image/')&&url?<img src={url} alt={file.name}/>:<Icon name="clip"/>}</span>;}
export default function UploadCards({pending,busy,onCancel,onRetry}){
 const files=[pending.snapshot.file,...(pending.snapshot.files||[])].filter(Boolean),p=pending.progress||{},failed=pending.state==='error';
 return <div className="upload-cards">{files.map((file,index)=>{const done=index<(p.index||0)||p.committing,total=index===p.index?p.total||file.size:file.size,sent=done?total:index===p.index?p.sent||0:0,ratio=total?Math.min(1,sent/total):0;return <article key={file.id} className="message outgoing upload-card" aria-label={'Загрузка '+file.name}>
 <div className="upload-file-row"><button className={'upload-control '+(!total?'indeterminate':'')} disabled={p.committing&&!failed} onClick={failed?onRetry:onCancel} aria-label={failed?'Повторить отправку '+file.name:'Отменить загрузку '+file.name}><svg viewBox="0 0 48 48" aria-hidden="true"><circle className="upload-track" cx="24" cy="24" r="21"/><circle className="upload-ring" cx="24" cy="24" r="21" pathLength="100" strokeDasharray={`${ratio*100} 100`}/></svg>{failed?<span aria-hidden="true">↻</span>:<Icon name={p.committing?'clip':'close'}/>}</button>
 <div className="upload-file-copy"><strong>{file.name}</strong><span role="status">{failed?'Не отправлено':p.committing?'Отправляем…':done?'Загружено · ждёт отправки':index>(p.index||0)?'В очереди':`${uploadSize(sent)} / ${uploadSize(total)}`}</span></div></div>
 {index===0&&pending.snapshot.text&&<p className="upload-caption">{pending.snapshot.text}</p>}<div className="message-meta">{failed&&<button onClick={onCancel}>Убрать</button>}<span>{failed?'Ошибка':'◷'}</span></div></article>;})}{failed&&<p className="upload-error" role="alert">{pending.error||'Не удалось отправить. Нажмите на значок, чтобы повторить.'}</p>}</div>;
}
