import React,{useEffect,useState} from 'react';
import Dialog from './Dialog';
import {request} from './api';
import './forum-desktop.css';
const dayString=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export default function DateJump({chat,token,initial,forum,onClose,onJump}){
 const [month,setMonth]=useState(()=>dayString(new Date(initial||Date.now())).slice(0,7)),[days,setDays]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const timeZone=date=>new Date(date+'T12:00:00').getTimezoneOffset();
 useEffect(()=>{const c=new AbortController();setDays([]);request(`/chats/${chat}/calendar?month=${month}&tz=${timeZone(month+'-01')}${forum?'&forum=1':''}`,token,undefined,c.signal).then(r=>setDays(r.days)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[chat,token,month,forum]);
 const first=new Date(month+'-01T12:00:00'),offset=(first.getDay()+6)%7,cells=Array.from({length:42},(_,i)=>{const d=new Date(first);d.setDate(1-offset+i);return d;});
 function move(delta){const d=new Date(first);d.setMonth(d.getMonth()+delta);setMonth(dayString(d).slice(0,7));}
 async function choose(date){if(busy)return;setBusy(true);setError('');try{const result=await request(`/chats/${chat}/calendar?date=${date}&tz=${timeZone(date)}${forum?'&forum=1':''}`,token);if(!result.anchor_id){setError('В истории пока нет сообщений');return;}await onJump(result);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Dialog title="Перейти к дате" className="chat-calendar" onClose={onClose}><header className="calendar-month"><button aria-label="Предыдущий месяц" onClick={()=>move(-1)}>‹</button><label><span>{first.toLocaleString('ru-RU',{month:'long',year:'numeric'})}</span><input aria-label="Месяц календаря" type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label><button aria-label="Следующий месяц" onClick={()=>move(1)}>›</button></header><div className="calendar-grid">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><small key={d}>{d}</small>)}{cells.map(d=>{const date=dayString(d),present=days.some(row=>row.date===date);return <button key={date} disabled={busy} className={(date.startsWith(month)?'':'other-month ')+(present?'has-messages':'')} aria-label={date+(present?' · есть сообщения':'')} onClick={()=>choose(date)}>{d.getDate()}</button>;})}</div>{error&&<p role="alert">{error}</p>}<p className="forum-help">Выберите день. Если сообщений в этот день нет, откроются ближайшие.</p></Dialog>;
}
