import React,{useEffect,useState} from 'react';
import Dialog from './Dialog';
import {clearEmojiCache} from './EmojiAsset';
const size=n=>n>1024*1024?(n/1024/1024).toFixed(1)+' МБ':Math.round(n/1024)+' КБ';
export default function DataSettings({onClose,me,demo=false,onReset}){
 const [usage,setUsage]=useState(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 async function inspect(){try{setUsage(await navigator.storage?.estimate());}catch{setUsage(null);}}
 useEffect(()=>{inspect();},[]);
 async function clear(){setBusy(true);setNote('');try{clearEmojiCache();if('caches'in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>/^volna-(?:media|files)-/.test(k)).map(k=>caches.delete(k)));}setNote('Кэш вложений очищен. Аккаунт, настройки и переписки сохранены.');await inspect();}catch{setNote('Браузер не разрешил очистку кэша.');}finally{setBusy(false);}}
 return <Dialog title="Данные и хранилище" onClose={onClose}><p>Занято этим сайтом: {usage?.usage!=null?size(usage.usage):'Браузер не сообщает объём'}</p><p className="muted-note">Объём включает ресурсы приложения и локальные настройки. Вложения действующего клиента загружаются с сервера; их просмотр не создаёт постоянную копию переписки.</p><button className="secondary" disabled={busy} onClick={clear}>Очистить кэш вложений</button>{demo&&<button className="secondary" onClick={onReset}>Сбросить демонстрационные данные</button>}<p role="status">{note}</p></Dialog>;
}
