import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Calls from './Calls';
import {saveSession} from './session.mjs';
import {uploadFile} from './api';
import './style.css';
import './native-call.css';
// The native bridge exists only in the dedicated, origin-locked Qt page. No
// credentials in URLs, cookies, DOM attributes or persistent browser storage.
async function connectNative(){
 if(!window.qt?.webChannelTransport||!window.QWebChannel)throw Error('Откройте модуль звонков из нативного клиента Волны');
 return new Promise(resolve=>new window.QWebChannel(window.qt.webChannelTransport,channel=>resolve(channel.objects.volnaNative)));
}
export async function mountNativeCalls(bridge){
 const refreshes=new Map();let next=0,show=()=>{};
 bridge.refreshFinished.connect((id,status,session)=>{const pending=refreshes.get(id);if(pending){clearTimeout(pending.timer);refreshes.delete(id);pending.resolve({status,session});}});
 window.volnaDesktop={platform:'win32',callState:async value=>bridge.state(value),onShowCall:fn=>{show=fn;return()=>{show=()=>{};}},saveAccounts:async()=>{},refreshSession:({token})=>new Promise((resolve,reject)=>{const id=String(++next),timer=setTimeout(()=>{refreshes.delete(id);reject(Error('Не удалось обновить сеанс звонка'));},25000);refreshes.set(id,{resolve,reject,timer});bridge.refresh(id,token);})};
 function App(){
  const [session,setSession]=useState(null),[error,setError]=useState(''),[media,setMedia]=useState(null),[recording,setRecording]=useState(false);
  const calls=useRef(null),current=useRef(null),recorder=useRef(null),chunks=useRef([]),timer=useRef(null),mediaUrl=useRef(null),recordWanted=useRef(false);
  function problem(message){setError(message);bridge.failed(message);}
  async function accept(value){if(value?.token){await saveSession(value,true,false);current.current=value;setSession(value);}else{current.current=null;setSession(null);recorder.current?.stop();}}
  async function stopRecording(){recordWanted.current=false;if(recorder.current?.state==='recording')recorder.current.stop();}
  async function record(chatId){
   if(calls.current?.isBusy())throw Error('Завершите звонок перед записью');if(recorder.current||recordWanted.current)throw Error('Запись уже идёт');recordWanted.current=true;
   const owner=current.current?.user?.id;if(!owner)throw Error('Войдите в аккаунт');const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!recordWanted.current||owner!==current.current?.user?.id){bridge.recording?.(false);stream.getTracks().forEach(t=>t.stop());return;}
   let capture;try{capture=new MediaRecorder(stream);}catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}recorder.current=capture;chunks.current=[];capture.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);};
   capture.onstop=async()=>{clearTimeout(timer.current);stream.getTracks().forEach(t=>t.stop());recorder.current=null;recordWanted.current=false;setRecording(false);const data=new Blob(chunks.current,{type:capture.mimeType});chunks.current=[];if(owner!==current.current?.user?.id||!data.size){bridge.recording?.(false);return;}
    try{const file=new File([data],`Голосовое-${Date.now()}.webm`,{type:data.type});const attachment=await uploadFile(file,current.current.token);if(owner===current.current?.user?.id)bridge.voiceUploaded({...attachment,native_chat_id:chatId});}catch(e){problem(e.message);}finally{bridge.recording?.(false);}};
   capture.start(1000);setRecording(true);bridge.recording?.(true);timer.current=setTimeout(stopRecording,5*60*1000);
  }
  useEffect(()=>{let disposed=false;
   const changed=value=>{if(!disposed)accept(value).catch(e=>problem(e.message));};bridge.sessionUpdated.connect(changed);
   const command=async(action,value)=>{if(disposed)return;try{if(action==='show'){show();}else if(action==='start'){if(recorder.current||recordWanted.current)throw Error('Сначала завершите запись голоса');show();await calls.current?.start(value.chat,!!value.video);}else if(action==='event')window.dispatchEvent(new CustomEvent('volna-media-event',{detail:value}));else if(action==='record')await record(value.chatId);else if(action==='stop-record')await stopRecording();else if(action==='media'){const bytes=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));if(bytes.length>20*1024*1024)throw Error('Файл слишком большой');if(mediaUrl.current)URL.revokeObjectURL(mediaUrl.current);const url=URL.createObjectURL(new Blob([bytes],{type:value.mime}));mediaUrl.current=url;setMedia({url,mime:value.mime});}}catch(e){if(action==='record'){recordWanted.current=false;bridge.recording?.(false);}problem(e.message);}};
   const visibility=()=>{if(document.querySelector('.call-panel.call-minimized'))bridge.minimize();};window.addEventListener('volna-call-visibility',visibility);
   bridge.command.connect(command);bridge.session(value=>{changed(value);});
   return()=>{disposed=true;window.removeEventListener('volna-call-visibility',visibility);bridge.sessionUpdated.disconnect(changed);bridge.command.disconnect(command);clearTimeout(timer.current);recorder.current?.stop();if(mediaUrl.current)URL.revokeObjectURL(mediaUrl.current);};
  },[]);
  useEffect(()=>{if(session&&calls.current)bridge.loaded();},[session?.user?.id]);
  return <main className="native-call-host"><p className="native-call-ready">Волна · {recording?'Запись голосового сообщения…':'Модуль звонков готов'}</p>{error&&<div role="alert">{error}<button onClick={()=>setError('')}>Закрыть</button></div>}{session&&<Calls ref={calls} token={session.token} accountId={session.user.id} accountName={session.user.name} onError={problem}/ >}{media&&<section className="native-media">{media.mime.startsWith('video/')?<video src={media.url} controls autoPlay/>:<audio src={media.url} controls autoPlay/>}<button onClick={()=>{URL.revokeObjectURL(media.url);mediaUrl.current=null;setMedia(null);}}>Закрыть файл</button></section>}</main>;
 }
 createRoot(document.getElementById('root')).render(<App/>);
}
if(!window.__VOLNA_NATIVE_CALL_TEST__)connectNative().then(mountNativeCalls).catch(error=>{document.getElementById('root').textContent=error.message;});
