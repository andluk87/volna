import React,{useEffect,useRef,useState} from 'react';
import {request} from './api';
import './bot-commands.css';
export default function BotCommandMenu({chatId,token,disabled=false,onCommand}){
 const [menu,setMenu]=useState(null),[open,setOpen]=useState(false),[sending,setSending]=useState(false),root=useRef(null);
 useEffect(()=>{setOpen(false);setMenu(null);if(!chatId||!token)return;const controller=new AbortController();request(`/chats/${chatId}/bot-commands`,token,undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setMenu({chatId,token,commands:Array.isArray(data.commands)?data.commands:[]});}).catch(()=>{});return()=>controller.abort();},[chatId,token]);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!root.current?.contains(e.target))setOpen(false);},escape=e=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector('.bot-menu-toggle')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);root.current?.querySelector('[role=menuitem]')?.focus();return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 const commands=menu?.chatId===chatId&&menu.token===token?menu.commands:[];
 if(!commands.length)return null;
 async function choose(command){if(sending||disabled)return;setSending(true);try{if(await onCommand(command)!==false)setOpen(false);}finally{setSending(false);}}
 return <div className="bot-command-menu" ref={root}><button type="button" className="bot-menu-toggle" aria-haspopup="menu" aria-expanded={open} disabled={disabled||sending} onClick={()=>setOpen(v=>!v)}>Меню</button>{open&&<div className="bot-command-popup" role="menu" aria-label="Команды бота" onKeyDown={e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const items=Array.from(root.current.querySelectorAll('[role=menuitem]')),index=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();}}>{commands.map(item=><button key={item.command} type="button" role="menuitem" disabled={disabled||sending} onClick={()=>choose(item.command)}><strong>{item.command}</strong><span>{item.description}</span></button>)}</div>}</div>;
}
