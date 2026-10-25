import React,{useEffect,useState} from 'react';
import {API} from './api';
import './desktop.css';
export function AppDownloads(){return <div className="app-downloads">{[['android','Android','Установочный файл APK','/download/volna-android.apk'],['windows','Windows 10/11','Установщик · x64 · обновления в приложении','/download/volna-windows.exe']].map(([kind,name,description,url])=><a key={kind} className={'android-download '+kind+'-download'} href={API+url} aria-label={'Скачать приложение VLN для '+name}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg><span><strong>VLN для {name}</strong><small>{description}</small></span><b>Скачать</b></a>)}</div>;}
export function DesktopUpdate(){
 const bridge=window.volnaDesktop,[state,setState]=useState(null);
 useEffect(()=>{if(!bridge?.updateState||bridge.secondary)return;let alive=true;
  const receive=value=>{if(alive)setState(value);};
  bridge.updateState().then(receive).catch(()=>{});const stop=bridge.onUpdate(receive);
  return()=>{alive=false;stop();};
 },[bridge]);
 if(!bridge||bridge.secondary||!state||!['available','downloading','ready','installing','error','checking'].includes(state.status)||state.status==='checking'&&!state.manual||state.status==='error'&&!state.manual&&!state.version)return null;
 const percent=Math.min(100,Math.max(0,Number(state.percent)||0));
 const waiting=['downloading','installing','checking'].includes(state.status);
 const label=state.status==='downloading'?`Загрузка обновления · ${Math.round(percent)}%`:state.status==='installing'?'Перезапускаем VLN…':state.status==='checking'?'Проверяем обновления…':state.status==='error'?'Повторить обновление':state.message?.includes('Завершите звонок')?'Обновить VLN · завершите звонок':'Обновить VLN';
 return <div className="desktop-update" data-status={state.status} aria-live="polite">
  <button type="button" disabled={waiting} aria-busy={waiting} title={state.message||'Установить обновление VLN'} onClick={()=>{
   const action=state.status==='error'?bridge.checkUpdates():bridge.update();
   action.catch(()=>setState(value=>({...value,status:'error',manual:true,message:'Не удалось обновить VLN. Повторите попытку.'})));
  }}>
   {state.status==='downloading'&&<span className="desktop-update-progress" style={{width:percent+'%'}} aria-hidden="true"/>}
   <svg className={waiting?'desktop-update-spinning':''} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a8 8 0 0 1 13-1L20 8M4 16l1.5 2a8 8 0 0 0 13-1"/></svg>
   <span>{label}</span>
  </button>
 </div>;
}

export function DesktopUpdateSettings(){const bridge=window.volnaDesktop,[state,setState]=useState(null),[error,setError]=useState('');useEffect(()=>{if(!bridge)return;bridge.updateState().then(setState).catch(()=>{});return bridge.onUpdate(setState);},[bridge]);if(!bridge)return null;return <section><h3>Обновления</h3><label className="setting-check"><input type="checkbox" checked={state?.idleInstall===true} disabled={!state} onChange={e=>bridge.setIdleInstall(e.target.checked).then(setState).catch(()=>setError('Не удалось сохранить настройку'))}/>Обновлять при простое</label><p className="muted-note">Скачивать заранее и устанавливать после 10 минут без клавиатуры и мыши, когда нет звонка. После установки VLN откроется снова.</p><button onClick={()=>bridge.checkUpdates().catch(()=>setError('Не удалось проверить обновления'))}>Проверить обновления</button>{state?.message&&<p className="muted-note" role="status">{state.message}{state.status==='downloading'?` ${Math.round(state.percent)}%`:state.version?` · ${state.version}`:''}</p>}{error&&<p role="alert">{error}</p>}</section>;}
