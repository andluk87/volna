import React,{useEffect,useState} from 'react';
import Dialog from './Dialog';
import {request} from './api';
import {desktopNotificationSettings,saveDesktopNotificationSettings} from './desktop-notifications.mjs';
export default function NotificationStartup({token,onConfigure}){
 const [issue,setIssue]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;(async()=>{try{
  if(window.volnaDesktop){const state=await window.volnaDesktop.notificationStatus?.();if(live){if(!desktopNotificationSettings().enabled)setIssue('desktop');else if(state?.systemEnabled===false)setIssue('windows');}return;}
  if(!window.isSecureContext||!('Notification' in window)||!('PushManager' in window)||!navigator.serviceWorker)return;
  if(Notification.permission!=='granted'){if(live)setIssue(Notification.permission);return;}
  const r=await navigator.serviceWorker.getRegistration(),sub=await r?.pushManager.getSubscription();
  const state=sub?await request('/push/status',token,{endpoint:sub.endpoint}):null;
  if(live&&!state?.subscribed)setIssue('subscription');
 }catch{if(live)setIssue('subscription');}})();return()=>{live=false;};},[token]);
 if(!issue)return null;
 return <Dialog title="Включить уведомления" onClose={()=>setIssue('')}><p>{issue==='windows'?'Уведомления Windows выключены. Откройте системные настройки и разрешите уведомления Волны и баннеры.':issue==='desktop'?'Уведомления Волны выключены. Включите их, чтобы видеть новые сообщения в других окнах.':issue==='denied'?'Браузер блокирует уведомления Волны. Разрешите их в настройках сайта, затем включите уведомления в приложении.':'Включите всплывающие уведомления, чтобы получать новые сообщения и входящие звонки.'}</p><button className="primary" onClick={()=>{try{if(issue==='windows'){window.volnaDesktop.notificationSettings().catch(()=>{});}if(issue==='desktop'){saveDesktopNotificationSettings({...desktopNotificationSettings(),enabled:true});}setIssue('');onConfigure();}catch{setError('Не удалось сохранить настройку');}}}>Включить</button><button onClick={()=>setIssue('')}>Позже</button>{error&&<p role="alert">{error}</p>}</Dialog>;
}
