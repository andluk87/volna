import React,{useEffect,useState} from 'react';
import {Icon} from './ui';
export default function PinBanner({pins,onJump}){
 const [selected,setSelected]=useState(null),[hidden,setHidden]=useState(false),[busy,setBusy]=useState(false);
 const pinIds=pins.map(m=>m.id).join(',');
 useEffect(()=>{setHidden(false);setSelected(null);},[pinIds]);
 if(hidden||!pins.length)return null;
 const index=Math.max(0,pins.findIndex(m=>m.id===selected)),message=pins[index];
 const preview=message.text||message.poll?.question||(message.attachment?.mime?.startsWith('audio/')?'Голосовое сообщение':message.attachment?.name)||'Сообщение';
 async function open(){if(busy)return;setBusy(true);try{if(await onJump(message)!==false)setSelected(pins[(index+1)%pins.length].id);}finally{setBusy(false);}}
 return <div className="pin-banner" role="region" aria-label="Закреплённое сообщение"><button type="button" className="pin-banner-jump" aria-label="Перейти к закреплённому сообщению" disabled={busy} onClick={open}><Icon name="pin"/><span className="pin-banner-marker" aria-hidden="true">{pins.slice(0,5).map((m,i)=><i key={m.id} className={i===index%5?'active':''}/>)}</span><span className="pin-banner-copy"><strong>Закреплённое сообщение{pins.length>1?' #'+(pins.length-index):''}</strong><span>{preview}</span></span></button><button type="button" className="pin-banner-close icon-button" aria-label="Скрыть закреплённое сообщение" onClick={()=>setHidden(true)}><Icon name="close"/></button></div>;
}
