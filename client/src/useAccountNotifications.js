import {useEffect,useState} from 'react';
import {events,request} from './api';
import {notifyDesktopMessage} from './desktop-notifications.mjs';
import {callDevices} from './call-devices.mjs';
export default function useAccountNotifications(accounts,selected){
 const [unread,setUnread]=useState({}),[revision,setRevision]=useState(0);
 useEffect(()=>{const update=()=>setRevision(v=>v+1);window.addEventListener('volna-push-settings',update);return()=>window.removeEventListener('volna-push-settings',update);},[]);
 useEffect(()=>{
  if(window.volnaDesktop?.secondary)return;
  const controller=new AbortController(),timers=[];
  for(const account of accounts){if(!account.token||account.user.id===selected)continue;const id=account.user.id;let preferences=[],ring='',polling=false;
   const refresh=async()=>{try{preferences=await request('/chats',account.token,undefined,controller.signal);if(!controller.signal.aborted)setUnread(old=>({...old,[id]:preferences.reduce((n,c)=>n+(c.parent_id?0:c.unread||0),0)}));}catch{}};
   events(account.token,controller.signal,event=>{
    if(controller.signal.aborted)return;
    if(event.type==='ready'||['chats','read','history-cleared','community'].includes(event.type))refresh();
    if(event.type==='message'&&event.message.sender_id!==id){request(`/chats/${event.message.chat_id}/delivered`,account.token,{message_id:event.message.id},controller.signal).catch(()=>{});if(event.notify!==false&&!preferences.find(c=>c.id===event.message.chat_id)?.muted)notifyDesktopMessage(event.message,id);refresh();}
   },()=>{},()=>{});
   if(window.volnaDesktop){const device=crypto.randomUUID().replaceAll('-','');const poll=async()=>{if(polling||controller.signal.aborted)return;polling=true;try{const call=await request('/calls/current?device='+device,account.token,undefined,controller.signal);if(call?.incoming&&call.status==='ringing'&&call.id!==ring&&callDevices().incoming){ring=call.id;window.volnaDesktop.notifyMessage({chatId:call.chat_id,accountId:id,title:'Входящий звонок · '+account.user.name,body:call.peer?.name||'Собеседник'}).catch(()=>{});}if(!call)ring='';}catch{}finally{polling=false;}};poll();timers.push(setInterval(poll,2000));}
  }
  return()=>{controller.abort();for(const timer of timers)clearInterval(timer);};
 },[accounts,selected]);
 useEffect(()=>{
  if(window.volnaDesktop||!('Notification' in window)||Notification.permission!=='granted'||!navigator.serviceWorker)return;
  let alive=true;(async()=>{try{const registration=await navigator.serviceWorker.getRegistration(),subscription=await registration?.pushManager.getSubscription();if(!subscription)return;
   for(const account of accounts){if(!alive)return;if(!account.token||localStorage.getItem('volna.web.push.enabled.'+account.user.id)==='false')continue;const state=await request('/push/status',account.token,{endpoint:subscription.endpoint});if(!state.subscribed)await request('/push/subscribe',account.token,{subscription:subscription.toJSON(),preview:state.preview});}
  }catch{}})();return()=>{alive=false;};
 },[accounts,revision]);
 return unread;
}
