import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Dialog from './Dialog';
import {Icon} from './ui';
import {request} from './api';
import './send-options.css';
export default function SendOptions({point,onClose,onSend,direct}){
 const ref=useRef(null),[schedule,setSchedule]=useState(false),[when,setWhen]=useState(()=>{const d=new Date(Date.now()+3600000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}),[effect,setEffect]=useState(null);
 const latest=useRef({onClose,schedule});latest.current={onClose,schedule};
 useEffect(()=>{const close=e=>{if(latest.current.schedule)return;if(e.type==='keydown'?e.key==='Escape':!ref.current?.contains(e.target))latest.current.onClose();};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);ref.current?.querySelector('button')?.focus();return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[]);
 const submit=options=>{onClose();onSend({...options,...(effect?{effect}:{})});};
 return createPortal(<><section className="send-options" role="menu" aria-label="Варианты отправки" ref={ref} style={{left:Math.max(8,Math.min(point.x-230,innerWidth-250)),top:Math.max(8,Math.min(point.y-230,innerHeight-260))}}><div className="send-effects"><small>Добавить анимированный эффект</small><div>{['👍','👎','❤️','🔥','🎉','💩','🥰'].map(e=><button key={e} aria-label={'Эффект '+e} aria-pressed={effect===e} onClick={()=>setEffect(old=>old===e?null:e)}>{e}</button>)}</div></div><button role="menuitem" onClick={()=>submit({silent:true})}><Icon name="bellOff"/>Отправить без звука</button><button role="menuitem" onClick={()=>setSchedule(true)}><Icon name="calendar"/>Отправить позже</button>{direct&&<button role="menuitem" onClick={()=>submit({when_online:true})}><Icon name="clock"/>Когда будет в сети</button>}{effect&&<button role="menuitem" onClick={()=>submit({})}>Отправить с эффектом</button>}</section>{schedule&&<Dialog title="Отправить позже" onClose={()=>setSchedule(false)}><label>Дата и время<input aria-label="Время отправки" type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></label><button className="primary" onClick={()=>submit({schedule_at:new Date(when).getTime()})}>Запланировать</button></Dialog>}</>,document.body);
}
export function ScheduledMessages({chat,token,revision,onClose}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>request(`/chats/${chat}/scheduled`,token).then(setRows).catch(e=>setError(e.message));useEffect(()=>{load();},[chat,token,revision]);
 async function act(id,send){setBusy(true);try{await request(`/scheduled/${id}${send?'/send':''}`,token,send?{}:undefined,undefined,send?'POST':'DELETE');await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Dialog title="Отложенные сообщения" onClose={onClose}>{error&&<p role="alert">{error}</p>}{rows.length?rows.map(r=><article className="scheduled-row" key={r.id}><strong>{r.when_online?'Когда контакт будет в сети':new Date(r.due).toLocaleString('ru-RU')}</strong><p>{r.payload.text||'Вложение'}</p>{r.error&&<small role="alert">{r.error}</small>}<div><button disabled={busy} onClick={()=>act(r.id,true)}>Отправить сейчас</button><button disabled={busy} onClick={()=>act(r.id,false)}>Отменить отправку</button></div></article>):<p>Нет отложенных сообщений</p>}</Dialog>;
}
