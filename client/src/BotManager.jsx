import React,{useEffect,useState} from 'react';
import Dialog from './Dialog';
import {request} from './api';
import './bots.css';
export async function openBotManager(token,onOpen){
 const chat=await request('/bots/manager',token,{});await onOpen(chat);
}
export function BotChatBanner({chat,token,onChanged}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
 useEffect(()=>{let disposed=false;setError('');request(`/chats/${chat.id}/bots`,token).then(data=>{if(!disposed)setBlocked(data.bots.some(b=>!b.active));}).catch(e=>{if(!disposed)setError(e.message);});return()=>{disposed=true;};},[chat.id,chat.can_send,token]);
 return <div className="bot-chat-banner"><span>Это бот. Он получает ваши сообщения в этом диалоге.</span>{error&&<span role="alert">{error}</span>}<button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await request(`/bots/${chat.peer_bot_id}/${blocked?'start':'block'}`,token,{});setBlocked(!blocked);await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}}>{blocked?'Разблокировать бота':'Заблокировать бота'}</button></div>;
}
export function GroupBots({chat,token,onClose,onChanged}){
 const [items,setItems]=useState([]),[username,setUsername]=useState(''),[visibility,setVisibility]=useState('restricted'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const admin=['owner','admin'].includes(chat.role);
 const load=async()=>setItems((await request(`/chats/${chat.id}/bots`,token)).bots);
 useEffect(()=>{let disposed=false;request(`/chats/${chat.id}/bots`,token).then(data=>{if(!disposed)setItems(data.bots);}).catch(e=>{if(!disposed)setError(e.message);});return()=>{disposed=true;};},[chat.id,token]);
 async function change(fn){setBusy(true);setError('');try{await fn();await load();await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Dialog title="Боты и доступ к группе" className="bot-manager" onClose={onClose}><p>Ограниченный доступ: команды, упоминания и ответы боту. Полный доступ позволяет получать все новые сообщения при наличии разрешения в токене.</p>{error&&<p role="alert" className="error">{error}</p>}{!items.length&&<p>В группе пока нет ботов с разрешениями.</p>}{items.map(item=><article className="bot-grant" key={item.bot.id}><strong>{item.bot.display_name} · @{item.bot.username}</strong><p>{!item.active?'Доступ отключён':item.visibility==='full_read'?'Разрешён доступ ко всем новым сообщениям':'Только команды, упоминания и ответы'}</p>{admin&&<>{item.active&&<button disabled={busy} onClick={()=>change(()=>request(`/chats/${chat.id}/bots/${item.bot.id}`,token,{visibility:item.visibility==='restricted'?'full_read':'restricted'},undefined,'PUT'))}>{item.visibility==='restricted'?'Разрешить полный доступ':'Ограничить доступ'}</button>}<button disabled={busy} onClick={()=>change(()=>request(`/chats/${chat.id}/bots/${item.bot.id}`,token,{},undefined,'DELETE'))}>Удалить из группы</button></>}</article>)}{admin&&<form onSubmit={e=>{e.preventDefault();change(async()=>{const bot=await request('/bots/resolve?username='+encodeURIComponent(username),token);await request(`/chats/${chat.id}/bots/${bot.id}`,token,{visibility},undefined,'PUT');setUsername('');});}}><label>Username бота<input required value={username} onChange={e=>setUsername(e.target.value)} maxLength={33}/></label><label>Доступ<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="restricted">Ограниченный</option><option value="full_read">Все новые сообщения</option></select></label><button className="primary" disabled={busy}>Добавить бота</button></form>}</Dialog>;
}
