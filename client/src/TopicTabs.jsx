import React,{useEffect,useState} from 'react';
import {request} from './api';
import './topics.css';
export default function TopicTabs({chat,token,revision,onSelect,onBrowse}){
 const group=chat.parent_id||chat.id,[info,setInfo]=useState(null);
 useEffect(()=>{const controller=new AbortController();request(`/groups/${group}/topics`,token,undefined,controller.signal).then(setInfo).catch(()=>{});return()=>controller.abort();},[group,token,revision]);
 if(!info?.enabled)return null;
 const rows=[info.general,...info.topics].filter(t=>t&&!t.hidden).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(a.pinned?a.pin_order-b.pin_order:0));
 return <nav className="forum-tabs" aria-label="Темы группы"><button onClick={onBrowse}>Все темы</button>{rows.map(t=><button key={t.id} aria-current={chat.id===t.id?'page':undefined} onClick={()=>onSelect(t.id)}>{t.icon||'#'} {t.name}{t.unread_count>0&&<small> {t.unread_count}</small>}</button>)}</nav>;
}
