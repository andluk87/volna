import React,{useEffect,useRef,useState} from 'react';
import {request} from './api';
import Dialog from './Dialog';
import './bot-interactions.css';
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
 const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms);
 const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});
});
export function BotButtons({message,token}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[alert,setAlert]=useState(null);
 const control=useRef(null),pending=useRef(null),locked=useRef(false),signature=JSON.stringify(message.bot_buttons||[]);
 useEffect(()=>{pending.current=null;locked.current=false;setBusy(false);setNote('');setAlert(null);return()=>{control.current?.abort();control.current=null;};},[message.id,signature,token]);
 async function press(button){
  if(locked.current)return;locked.current=true;setBusy(true);setNote('');
  const controller=new AbortController();control.current=controller;
  if(pending.current?.button!==button.id)pending.current={button:button.id,id:crypto.randomUUID()};
  try{
   let result=await request('/bots/interactions',token,{message_id:message.id,button_id:button.id,interaction_id:pending.current.id},controller.signal);
   const deadline=performance.now()+120000;
   while(result.status==='pending'&&performance.now()<deadline){await pause(2000,controller.signal);result=await request('/bots/interactions/'+result.callback_id,token,undefined,controller.signal);}
   if(controller.signal.aborted)return;
   if(result.status==='answered'){pending.current=null;if(result.answer.show_alert)setAlert(result.answer.text);else setNote(result.answer.text||'Готово');}
   else{pending.current=null;setNote('Бот не ответил вовремя. Можно нажать ещё раз.');}
  }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)setNote(e.message);}
  finally{if(!controller.signal.aborted){locked.current=false;setBusy(false);}}
 }
 if(!message.bot_buttons?.length||message.deleted_at)return null;
 return <div className="bot-inline" onClick={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()}>
  {message.bot_buttons.map((row,index)=><div className="bot-inline-row" key={index}>{row.map(button=><button type="button" key={button.id} disabled={busy} aria-busy={busy&&pending.current?.button===button.id} onClick={()=>press(button)}>{button.text}</button>)}</div>)}
  {busy&&<small role="status">Ожидаем ответ бота…</small>}{note&&<small role="status">{note}</small>}
  {alert!==null&&<Dialog title="Ответ бота" onClose={()=>setAlert(null)}><p>{alert}</p><button onClick={()=>setAlert(null)}>Закрыть</button></Dialog>}
 </div>;
}
export function BotCommands({chat,token,disabled,onChoose}){
 const [bots,setBots]=useState([]),[error,setError]=useState(''),[open,setOpen]=useState(false);
 const sequence=useRef(0);
 async function load(signal){const n=++sequence.current;try{const data=await request('/chats/'+chat.id+'/bot-commands',token,undefined,signal);if(n===sequence.current&&!signal?.aborted){setBots(data.bots);setError('');}}catch(e){if(n===sequence.current&&e.name!=='AbortError')setError(e.message);}}
 useEffect(()=>{const controller=new AbortController();setBots([]);setOpen(false);load(controller.signal);const refresh=()=>load(controller.signal);window.addEventListener('volna-bot-commands',refresh);return()=>{controller.abort();sequence.current++;window.removeEventListener('volna-bot-commands',refresh);};},[chat.id,token]);
 const commands=bots.flatMap(bot=>bot.commands.map(command=>({...command,username:bot.username})));
 if(!commands.length&&!error)return null;
 return <div className="bot-command-menu"><button type="button" disabled={disabled} aria-expanded={open} onClick={()=>{setOpen(v=>!v);load();}}>Команды</button>{open&&<div className="bot-command-list" role="menu" aria-label="Команды ботов">{error&&<p role="alert">{error}</p>}{commands.map(c=><button role="menuitem" type="button" key={c.username+':'+c.command} onClick={()=>{onChoose('/'+c.command+(chat.kind==='group'?'@'+c.username:''));setOpen(false);}}><strong>/{c.command}{chat.kind==='group'?'@'+c.username:''}</strong><span>{c.description}</span></button>)}</div>}</div>;
}
