import {useEffect} from 'react';
import {API} from './api';
import {sessionFetch} from './session.mjs';
const client=crypto.randomUUID().replaceAll('-','');let sequence=0;
export default function usePresence(token,enabled=true){
 useEffect(()=>{if(!token||!enabled)return;let live=true;
 const report=visible=>sessionFetch(API+'/api/presence',{method:'POST',keepalive:true,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({client,sequence:++sequence,visible})}).catch(()=>{});
 const sync=()=>{if(live)report(document.visibilityState==='visible'&&document.hasFocus());};
 sync();const timer=setInterval(sync,10000);window.addEventListener('focus',sync);window.addEventListener('blur',sync);document.addEventListener('visibilitychange',sync);const hide=()=>report(false);window.addEventListener('pagehide',hide);
 return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',sync);window.removeEventListener('blur',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('pagehide',hide);report(false);};
 },[token,enabled]);
}
