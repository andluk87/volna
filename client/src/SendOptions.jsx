import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
import './send-options.css';
import ScheduleDialog from './ScheduleDialog';
export default function SendOptions({point,onClose,onSend,direct}){
 const ref=useRef(null),[schedule,setSchedule]=useState(false),[effect,setEffect]=useState(null);
 const latest=useRef({onClose,schedule});latest.current={onClose,schedule};
 useEffect(()=>{const close=e=>{if(latest.current.schedule)return;if(e.type==='keydown'?e.key==='Escape':!ref.current?.contains(e.target))latest.current.onClose();};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);ref.current?.querySelector('button')?.focus();return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[]);
 const submit=options=>{onClose();onSend({...options,...(effect?{effect}:{})});};
 return createPortal(<><section hidden={schedule} className="send-options" role="menu" aria-label="Варианты отправки" ref={ref} style={{left:Math.max(8,Math.min(point.x-230,innerWidth-250)),top:Math.max(8,Math.min(point.y-230,innerHeight-260))}}><div className="send-effects"><small>Добавить анимированный эффект</small><div>{['👍','👎','❤️','🔥','🎉','💩','🥰'].map(e=><button key={e} aria-label={'Эффект '+e} aria-pressed={effect===e} onClick={()=>setEffect(old=>old===e?null:e)}>{e}</button>)}</div></div><button role="menuitem" onClick={()=>submit({silent:true})}><Icon name="bellOff"/>Отправить без звука</button><button role="menuitem" onClick={()=>setSchedule(true)}><Icon name="calendar"/>Отправить позже</button>{direct&&<button role="menuitem" onClick={()=>submit({when_online:true})}><Icon name="clock"/>Когда будет в сети</button>}{effect&&<button role="menuitem" onClick={()=>submit({})}>Отправить с эффектом</button>}</section>{schedule&&<ScheduleDialog onClose={()=>setSchedule(false)} onConfirm={options=>submit(options)}/>}</>,document.body);
}
export {default as ScheduledMessages} from './ScheduledMessages';
