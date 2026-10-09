import React,{useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';
export default function InstallApp(){
 const [prompt,setPrompt]=useState(null),[help,setHelp]=useState(false),[busy,setBusy]=useState(false);
 const [installed,setInstalled]=useState(()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
 const native=Capacitor.isNativePlatform()||location.protocol==='app:'||location.protocol==='file:';
 useEffect(()=>{
  if(native)return;
  const media=matchMedia('(display-mode: standalone)');
  const offer=e=>{e.preventDefault();setPrompt(e);};
  const done=()=>{setInstalled(true);setPrompt(null);setHelp(false);};
  const changed=()=>setInstalled(media.matches||navigator.standalone===true);
  window.addEventListener('beforeinstallprompt',offer);window.addEventListener('appinstalled',done);media.addEventListener('change',changed);
  if(import.meta.env.PROD&&window.isSecureContext&&'serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});}
  return()=>{window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',done);media.removeEventListener('change',changed);};
 },[native]);
 if(native||installed)return null;
 async function install(){if(!prompt){setHelp(true);return;}setBusy(true);try{await prompt.prompt();await prompt.userChoice;}catch{setHelp(true);}finally{setPrompt(null);setBusy(false);}}
 return <><button className="install-app" onClick={install} disabled={busy}>↓ {busy?'Открываем установку…':'Установить приложение'}</button>{help&&<div className="modal-backdrop"><section className="modal install-help" role="dialog" aria-modal="true" aria-labelledby="install-title"><button className="icon-button" autoFocus aria-label="Закрыть установку" onClick={()=>setHelp(false)}>×</button><img src="./icons/icon-192.png" width="64" height="64" alt=""/><h2 id="install-title">Волна всегда под рукой</h2><p>Приложение открывается в отдельном окне со значка на экране.</p>{!window.isSecureContext&&<p className="error">Для установки откройте Волну по HTTPS.</p>}<p><strong>Android:</strong> откройте сайт в Chrome, затем меню ⋮ → «Установить приложение» или «Добавить на главный экран».</p><p><strong>Компьютер:</strong> в Chrome или Edge нажмите значок установки в адресной строке или найдите установку приложения в меню браузера.</p><p><strong>iPhone / iPad:</strong> в Safari нажмите «Поделиться» → «На экран Домой».</p><p>Если пункта установки нет, попробуйте другой поддерживаемый браузер. Для сообщений нужен интернет. Уведомления можно включить после входа в разделе «Уведомления».</p><button className="primary" onClick={()=>setHelp(false)}>Понятно</button></section></div>}</>;
}
