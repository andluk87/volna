import React,{useEffect,useState} from 'react';
import {Capacitor,registerPlugin} from '@capacitor/core';
import {Icon} from './ui';
export const AndroidRoute=registerPlugin('VolnaAudio');
export default function AudioOutput({audioRef,active}){
 const [devices,setDevices]=useState([]),[selected,setSelected]=useState('default'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const native=Capacitor.getPlatform()==='android';
 const supported=native||typeof HTMLMediaElement.prototype.setSinkId==='function';
 useEffect(()=>{if(!active)return;let gone=false;
  async function refresh(){try{if(native){const r=await AndroidRoute.devices();if(!gone){setDevices(r.devices);setSelected(r.current||'default');}}else if(supported){const list=await navigator.mediaDevices.enumerateDevices();if(gone)return;const out=list.filter(d=>d.kind==='audiooutput'&&d.deviceId&&d.deviceId!=='default');setDevices(out.map((d,i)=>({id:d.deviceId,label:d.label||'Устройство '+(i+1)})));if(audioRef.current?.sinkId&&!out.some(d=>d.deviceId===audioRef.current.sinkId)){await audioRef.current.setSinkId('');if(!gone)setSelected('default');}}}catch{if(!gone)setError('Не удалось получить список аудиоустройств');}}
  if(native)AndroidRoute.start().catch(()=>{});
  refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);const timer=native?setInterval(refresh,3000):null;
  return()=>{gone=true;clearInterval(timer);navigator.mediaDevices?.removeEventListener('devicechange',refresh);if(native)AndroidRoute.reset().catch(()=>{});};
 },[active,native,supported]);
 async function select(id){setBusy(true);setError('');try{if(native)await AndroidRoute.select({id});else await audioRef.current.setSinkId(id==='default'?'':id);setSelected(id);}catch{setError('Не удалось переключить звук. Проверьте подключение и разрешение устройства.');}finally{setBusy(false);}}
 async function choose(){setBusy(true);setError('');try{const d=await navigator.mediaDevices.selectAudioOutput();await audioRef.current.setSinkId(d.deviceId);setDevices(list=>[...list.filter(x=>x.id!==d.deviceId),{id:d.deviceId,label:d.label||'Выбранное устройство'}]);setSelected(d.deviceId);}catch(e){if(e.name!=='NotAllowedError')setError('Выбор устройства недоступен');}finally{setBusy(false);}}
 if(!active)return null;
 return <section className="audio-output"><label><Icon name="speaker"/> Вывод звука{supported?<select aria-label="Устройство вывода звука" value={selected} disabled={busy} onChange={e=>select(e.target.value)}><option value="default">Как в системе</option>{devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select>:<small>Браузер выбирает выход автоматически. Подключите наушники или выберите устройство в системной панели звука Android.</small>}</label>{!native&&navigator.mediaDevices?.selectAudioOutput&&<button onClick={choose} disabled={busy}>Выбрать другое устройство</button>}{native&&<button disabled={busy} onClick={async()=>{try{await AndroidRoute.bluetooth();const r=await AndroidRoute.devices();setDevices(r.devices);}catch{setError('Разрешите доступ к Bluetooth в настройках приложения');}}}>Разрешить Bluetooth</button>}{error&&<small role="alert">{error}</small>}</section>;
}
