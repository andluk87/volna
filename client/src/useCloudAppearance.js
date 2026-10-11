import {useEffect,useRef,useState} from 'react';
import {request} from './api';
import {wallpaperBlob,saveWallpaper} from './background.mjs';
const imageData=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
import {normalizeAppearance,defaults} from './appearance.mjs';
// A failed restore must never upload local defaults over an existing cloud profile.
export default function useCloudAppearance(token,user,settings,apply,onError){
 const platform=window.volnaDesktop?'windows':'web',key=user?`volna.appearance.${platform}.${user}`:null;
 const current=useRef(settings);current.current=settings;
 const accepted=useRef(''),restoring=useRef(false),[ready,setReady]=useState(null),[wallpaperRevision,setWallpaperRevision]=useState(0);
 useEffect(()=>{const changed=()=>{if(!restoring.current)setWallpaperRevision(v=>v+1);};window.addEventListener('volna-wallpaper',changed);return()=>window.removeEventListener('volna-wallpaper',changed);},[]);
 useEffect(()=>{
  setReady(null);setWallpaperRevision(0);if(!token||!key)return;
  let stopped=false;const controller=new AbortController();
  const restore=async()=>{try{
   const cached=localStorage.getItem(key);
   const result=await request(`/me/appearance/${platform}`,token,undefined,controller.signal);
   if(stopped)return;
   const pending=localStorage.getItem(key+'.pending')==='1'&&cached;
   const value=normalizeAppearance(pending?JSON.parse(cached):result.settings||(cached?JSON.parse(cached):localStorage.getItem('volna.appearance.migrated')?{...defaults,...(platform==='windows'?{size:14,radius:8}:{})}:current.current));
   accepted.current=result.settings&&!pending?JSON.stringify(value):'';
   restoring.current=true;
   if(!pending&&result.settings?.wallpaper){const response=await fetch(result.settings.wallpaper);await saveWallpaper(await response.blob());}else if(!pending&&(result.settings||cached))await saveWallpaper(null);
   restoring.current=false;if(stopped)return;
   apply(value);localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('volna.appearance.migrated','1');setReady(key);onError(false);
  }catch(e){restoring.current=false;if(!stopped){onError(true);retry=setTimeout(restore,5000);}}};
  let retry;restore();return()=>{stopped=true;controller.abort();clearTimeout(retry);};
 },[token,key,platform]);
 useEffect(()=>{
  if(!token||!key||ready!==key)return;
  const serialized=JSON.stringify(settings);try{localStorage.setItem(key,serialized);}catch{onError(true);}
  if(serialized===accepted.current&&wallpaperRevision===0)return;
  try{localStorage.setItem(key+'.pending','1');}catch{onError(true);}
  let stopped=false,retry;const controller=new AbortController();
  const save=async()=>{try{const blob=settings.background==='image'?await wallpaperBlob():null;const payload=blob?{...settings,wallpaper:await imageData(blob)}:settings;await request(`/me/appearance/${platform}`,token,{settings:payload},controller.signal);if(!stopped){accepted.current=serialized;localStorage.removeItem(key+'.pending');onError(false);}}catch{if(!stopped){onError(true);retry=setTimeout(save,5000);}}};
  const timer=setTimeout(save,400);return()=>{stopped=true;clearTimeout(timer);clearTimeout(retry);controller.abort();};
 },[token,key,ready,settings,platform,wallpaperRevision]);
 return !token||!key||ready===key;
}
