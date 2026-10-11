import {useEffect,useRef,useState} from 'react';
import {request} from './api';
import {defaultFolders,normalizeFolders} from './sidebar-state.mjs';
export default function useAccountFolders(account,token,demo){
 const [state,setState]=useState({version:-1,folders:defaultFolders()}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(state),saving=useRef(false),editing=useRef(false),owner=useRef(null),generation=useRef(0);current.current=state;
 useEffect(()=>{const epoch=++generation.current;const key='volna.account.folders.'+(demo?'demo.':'')+account;let cached;try{cached=JSON.parse(localStorage.getItem(key));}catch{}
  if(owner.current!==key){owner.current=key;const initial={version:demo?0:-1,folders:cached?normalizeFolders(cached.folders):defaultFolders()};current.current=initial;setState(initial);setError('');editing.current=false;}saving.current=false;setBusy(false);
  async function refresh(){if(!account||!token||demo||saving.current||editing.current)return;try{const next=await request('/folders',token);if(generation.current!==epoch||saving.current||editing.current||next.version<current.current.version)return;current.current=next;setState(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{}}catch(e){if(generation.current===epoch&&current.current.version<0)setError(e.message);}}
  refresh();const timer=setInterval(refresh,5000);window.addEventListener('volna-folders-updated',refresh);window.addEventListener('online',refresh);return()=>{generation.current++;clearInterval(timer);window.removeEventListener('volna-folders-updated',refresh);window.removeEventListener('online',refresh);};
 },[account,token,demo]);
 async function change(items){if(saving.current||current.current.version<0){setError('Дождитесь загрузки папок с сервера');return false;}const epoch=generation.current;saving.current=true;setBusy(true);setError('');try{
  const next=demo?{version:current.current.version+1,folders:normalizeFolders(items)}:await request('/folders',token,{version:current.current.version,folders:items});
  if(generation.current!==epoch)return false;current.current=next;setState(next);try{localStorage.setItem('volna.account.folders.'+(demo?'demo.':'')+account,JSON.stringify(next));}catch{}return true;
 }catch(e){if(generation.current===epoch){setError(e.message);if(e.status===409){try{const remote=await request('/folders',token);if(generation.current===epoch){current.current=remote;setState(remote);}}catch{}}}return false;}finally{if(generation.current===epoch){saving.current=false;setBusy(false);}}}
 return [state.folders,change,busy||state.version<0,error,value=>{editing.current=value;}];
}
