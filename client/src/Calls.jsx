import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {API,request,messageId} from './api';
import {Avatar,Icon} from './ui';
import {CallTones,callTone} from './call-tones.mjs';
import './call-video.css';
import AudioOutput,{AndroidRoute as NativeCall} from './AudioOutput';

function gather(pc){return new Promise(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};const check=()=>{if(pc.iceGatheringState==='complete')done();};const timer=setTimeout(done,10000);pc.addEventListener('icegatheringstatechange',check);check();});}

export default forwardRef(function Calls({token,onError,onBeforeCall},ref){
 const [call,setCall]=useState(null),[phase,setPhase]=useState(''),[muted,setMuted]=useState(false),[elapsed,setElapsed]=useState(0),[soundBlocked,setSoundBlocked]=useState(false),[relay,setRelay]=useState(true),[hasAudio,setHasAudio]=useState(false),[minimized,setMinimized]=useState(false),[sharing,setSharing]=useState(false),[remoteSharing,setRemoteSharing]=useState(false),[screenReady,setScreenReady]=useState(false);
 const [cameraEnabled,setCameraEnabled]=useState(false),[videoMode,setVideoMode]=useState(false),[localMain,setLocalMain]=useState(false),[controls,setControls]=useState(true),[position,setPosition]=useState({x:1,y:0}),[front,setFront]=useState(true);
 const camera=useRef(null),localVideo=useRef(null),cameraWanted=useRef(false),videoBusy=useRef(false),stage=useRef(null),drag=useRef(null);
 const device=useRef(messageId()),current=useRef(null),peer=useRef(null),stream=useRef(null),remote=useRef(null),remoteVideo=useRef(null),remoteAudioStream=useRef(null),remoteScreenStream=useRef(null),screen=useRef(null),operation=useRef(false),generation=useRef(0),connectedAt=useRef(0),disconnect=useRef(null),started=useRef(0);
 const tones=useRef(null);if(!tones.current)tones.current=new CallTones();
 function update(c){current.current=c;setCall(c);tones.current.set(callTone(c,!!connectedAt.current));window.volnaDesktop?.callState({active:!!c,incoming:!!c?.incoming&&c.status==='ringing',id:c?.id,name:c?.peer?.name}).catch(()=>{});if(typeof c?.peer_sharing==='boolean'||typeof c?.peer_video==='boolean')setRemoteSharing(!!c.peer_sharing||!!c.peer_video);if(c?.video||c?.peer_video||c?.peer_sharing)setVideoMode(true);}
 function keepAlive(active,c=current.current){if(Capacitor.getPlatform()==='android')NativeCall.keepAlive({active,api:API,token,device:device.current,peer:c?.peer?.name||'Volna'}).catch(()=>{});}
 function videoSender(){return peer.current?.getTransceivers?.().find(t=>t.receiver?.track?.kind==='video')?.sender||null;}
 async function stopScreenShare(){const c=current.current,captured=screen.current;screen.current=null;if(c&&captured)request(`/calls/${c.id}/screen`,token,{device:device.current,sharing:false}).catch(()=>{});if(captured){captured.track.onended=null;captured.track.stop();}const sender=videoSender();try{if(sender?.track)await sender.replaceTrack(null);}catch{}setSharing(false);}
 function cleanup(){keepAlive(false);cameraWanted.current=false;camera.current?.getTracks().forEach(t=>t.stop());camera.current=null;setCameraEnabled(false);setVideoMode(false);setLocalMain(false);setPosition({x:1,y:0});setControls(true);setFront(true);stopScreenShare();generation.current++;clearTimeout(disconnect.current);peer.current?.close();peer.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(remote.current)remote.current.srcObject=null;if(remoteVideo.current)remoteVideo.current.srcObject=null;remoteAudioStream.current=null;remoteScreenStream.current=null;update(null);setMuted(false);setHasAudio(false);setMinimized(false);setRemoteSharing(false);setScreenReady(false);setPhase('');setElapsed(0);setSoundBlocked(false);connectedAt.current=0;operation.current=false;}
 async function end(){const c=current.current;cleanup();if(c)try{await request(`/calls/${c.id}/end`,token,{device:device.current});}catch{}}
 const endRef=useRef(end);endRef.current=end;
 function check(version){if(version!==generation.current)throw Object.assign(Error('Отменено'),{name:'AbortError'});}
 async function toggleScreenShare(){
  if(screen.current){await stopScreenShare();return;}
  if(!navigator.mediaDevices?.getDisplayMedia){onError('Демонстрация экрана недоступна в этом браузере. Откройте Волна в актуальном браузере на HTTPS.');return;}
  if(camera.current)await toggleCamera(false);
  const version=generation.current,pc=peer.current;let capture;
  try{capture=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:15},width:{ideal:1280,max:1280},height:{ideal:720,max:720}},audio:false});if(version!==generation.current||pc!==peer.current){capture.getTracks().forEach(t=>t.stop());return;}const track=capture.getVideoTracks()[0],sender=videoSender();if(!track||!sender)throw Error('Видеоканал звонка недоступен. Обновите приложение у обоих участников.');screen.current={stream:capture,track};await sender.replaceTrack(track);if(version!==generation.current){capture.getTracks().forEach(t=>t.stop());return;}await request(`/calls/${current.current.id}/screen`,token,{device:device.current,sharing:true});if(version!==generation.current){capture.getTracks().forEach(t=>t.stop());return;}track.onended=()=>{if(screen.current?.track===track)stopScreenShare();};setSharing(true);}catch(e){capture?.getTracks().forEach(t=>t.stop());if(screen.current?.stream===capture)screen.current=null;if(e.name!=='NotAllowedError')onError(e.message||'Не удалось начать демонстрацию экрана');}
 }
 async function toggleCamera(enabled=!camera.current,facing=front){
  if(videoBusy.current)return;videoBusy.current=true;const version=generation.current,pc=peer.current;let capture;
  try {
   if(!enabled){const old=camera.current;camera.current=null;old?.getTracks().forEach(t=>t.stop());if(!screen.current)await videoSender()?.replaceTrack(null);setCameraEnabled(false);if(current.current)await request(`/calls/${current.current.id}/camera`,token,{device:device.current,enabled:false});return;}
   if(screen.current)await stopScreenShare();
   capture=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing?'user':'environment'},width:{ideal:640},height:{ideal:480}}});
   if(version!==generation.current||pc!==peer.current){capture.getTracks().forEach(t=>t.stop());return;}
   const track=capture.getVideoTracks()[0],sender=videoSender();if(!track||!sender)throw Error('Видеоканал недоступен. Обновите приложение у обоих участников.');
   await sender.replaceTrack(track);check(version);const old=camera.current;camera.current=capture;old?.getTracks().forEach(t=>t.stop());setFront(facing);setCameraEnabled(true);setVideoMode(true);
   if(localVideo.current)localVideo.current.srcObject=capture;
   await request(`/calls/${current.current.id}/camera`,token,{device:device.current,enabled:true});check(version);
   track.onended=()=>{if(camera.current===capture)toggleCamera(false);};
  }catch(e){capture?.getTracks().forEach(t=>t.stop());if(version===generation.current){if(camera.current===capture){camera.current=null;setCameraEnabled(false);videoSender()?.replaceTrack(null).catch(()=>{});request(`/calls/${current.current?.id}/camera`,token,{device:device.current,enabled:false}).catch(()=>{});}if(e.name!=='AbortError')onError(e.name==='NotAllowedError'?'Разрешите доступ к камере. Голосовой звонок продолжается.':e.message||'Не удалось включить камеру');}}
  finally{videoBusy.current=false;}
 }
 async function openPip(){const video=localMain?localVideo.current:remoteVideo.current;if(!video?.srcObject){onError('Включите видео для маленького окна');return;}try{await video.requestPictureInPicture();}catch{onError('Маленькое окно недоступно в этом браузере');}}
 function previewDown(e){e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,position,moved:false};}
 function previewMove(e){const d=drag.current,rect=stage.current?.getBoundingClientRect();if(!d||!rect)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;const maxX=Math.max(1,rect.width-110),maxY=Math.max(1,rect.height-148);setPosition({x:Math.max(0,Math.min(1,d.position.x+dx/maxX)),y:Math.max(0,Math.min(1,d.position.y+dy/maxY))});}
 function previewUp(e){e.stopPropagation();if(drag.current&&!drag.current.moved)setLocalMain(v=>!v);drag.current=null;}
 async function prepare(version){
  onBeforeCall?.();
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw Error('Для звонка нужен HTTPS и браузер с поддержкой микрофона и WebRTC');
  const config=await request('/calls/config',token);check(version);setRelay(config.relayConfigured);
  const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(version!==generation.current){media.getTracks().forEach(t=>t.stop());check(version);}stream.current=media;setHasAudio(true);keepAlive(true);
  window.dispatchEvent(new CustomEvent('volna-audio-play',{detail:null}));
  const pc=new RTCPeerConnection({iceServers:config.iceServers});peer.current=pc;media.getTracks().forEach(t=>pc.addTrack(t,media));
  if(pc.addTransceiver)pc.addTransceiver('video',{direction:'sendrecv'});
  remoteAudioStream.current=new MediaStream();remoteScreenStream.current=new MediaStream();
  pc.ontrack=e=>{if(pc!==peer.current)return;const video=e.track.kind==='video',received=video?remoteScreenStream.current:remoteAudioStream.current;if(!received.getTracks().some(t=>t.id===e.track.id))received.addTrack(e.track);
   if(video){if(remoteVideo.current)remoteVideo.current.srcObject=received;if(current.current?.peer_sharing===undefined){setRemoteSharing(!e.track.muted);e.track.onmute=()=>setRemoteSharing(false);e.track.onunmute=()=>setRemoteSharing(true);}e.track.onended=()=>setRemoteSharing(false);}
   else{if(remote.current)remote.current.srcObject=received;remote.current?.play().catch(()=>setSoundBlocked(true));}
  };
  pc.onconnectionstatechange=()=>{if(pc!==peer.current)return;if(pc.connectionState==='connected'){tones.current.stop();clearTimeout(disconnect.current);setPhase('Разговор');if(!connectedAt.current)connectedAt.current=Date.now();setScreenReady(pc.getTransceivers().some(t=>t.receiver?.track?.kind==='video'&&['sendrecv','sendonly'].includes(t.currentDirection)));}else if(pc.connectionState==='failed'){onError('Не удалось установить звонок. Проверьте TURN и доступность сети.');endRef.current();}else if(pc.connectionState==='disconnected'){setPhase('Восстанавливаем соединение…');disconnect.current=setTimeout(()=>{onError('Звонок прерван: соединение потеряно');endRef.current();},20000);}};
  return pc;
 }
 async function start(chat,video=false){
  if(current.current||operation.current){onError('Сначала завершите текущий звонок');return;}
  cameraWanted.current=!!video;tones.current.unlock();window.volnaDesktop?.callState({active:true}).catch(()=>{});operation.current=true;const version=++generation.current;setPhase('Подготовка звонка…');started.current=Date.now();
  try{const c=await request('/calls/start',token,{chat_id:chat.id,device:device.current,video:!!video});if(version!==generation.current){request(`/calls/${c.id}/end`,token,{device:device.current}).catch(()=>{});return;}update(c);const pc=await prepare(version);check(version);await pc.setLocalDescription(await pc.createOffer());await gather(pc);check(version);const result=await request(`/calls/${c.id}/offer`,token,{device:device.current,description:pc.localDescription.toJSON()});check(version);update(result);setPhase('Вызываем…');}catch(e){if(e.name!=='AbortError'){onError(e.message);await end();}}finally{if(version===generation.current)operation.current=false;}
 }
 async function accept(){const c=current.current;cameraWanted.current=!!c?.video;if(!c||operation.current)return;tones.current.unlock();operation.current=true;const version=++generation.current;started.current=Date.now();setPhase('Подключаем микрофон…');
  try{const accepted=await request(`/calls/${c.id}/accept`,token,{device:device.current});check(version);update(accepted);const pc=await prepare(version);check(version);await pc.setRemoteDescription(c.offer);await pc.setLocalDescription(await pc.createAnswer());setScreenReady(pc.getTransceivers().some(t=>t.receiver?.track?.kind==='video'&&['sendrecv','sendonly'].includes(t.currentDirection)));await gather(pc);check(version);const result=await request(`/calls/${c.id}/answer`,token,{device:device.current,description:pc.localDescription.toJSON()});check(version);update(result);if(pc.connectionState!=='connected')setPhase('Соединяем…');}catch(e){if(e.name!=='AbortError'){onError(e.message);await end();}}finally{if(version===generation.current)operation.current=false;}
 }
 useImperativeHandle(ref,()=>({start,isBusy:()=>!!current.current||operation.current}));
 useEffect(()=>{
  let disposed=false,polling=false,lastSuccess=Date.now();
  async function poll(){if(disposed||polling||operation.current)return;polling=true;const version=generation.current;
   try{const c=await request('/calls/current?device='+device.current,token);if(disposed||version!==generation.current||operation.current)return;lastSuccess=Date.now();if(!c){if(current.current){onError('Звонок завершён или собеседник не ответил');cleanup();}return;}if(c.status==='other-device'){if(current.current){cleanup();onError('Звонок принят на другом устройстве');}return;}
    if(current.current&&current.current.id!==c.id)cleanup();
    if(!c.incoming&&c.status==='connecting'&&current.current?.status==='ringing'){started.current=Date.now();setPhase('Собеседник отвечает…');}
    if(!current.current){if(c.incoming&&c.status==='ringing'){update(c);setPhase(c.video?'Входящий видеозвонок':'Входящий аудиозвонок');}else return;}else if(current.current.id===c.id)update(c);
    const pc=peer.current;if(!c.incoming&&c.answer&&pc&&!pc.remoteDescription){started.current=Date.now();await pc.setRemoteDescription(c.answer);setScreenReady(pc.getTransceivers().some(t=>t.receiver?.track?.kind==='video'&&['sendrecv','sendonly'].includes(t.currentDirection)));if(pc.connectionState!=='connected')setPhase('Соединяем…');}
    if(pc&&pc.connectionState!=='connected'&&Date.now()-started.current>60000){onError('Не удалось соединиться за минуту. Проверьте сеть и TURN.');await endRef.current();}
   }catch(e){if(!disposed&&current.current&&!document.hidden&&(e.status===401||Date.now()-lastSuccess>20000)){onError('Звонок прерван: нет связи с сервером');cleanup();}}
   finally{polling=false;}
  }
  poll();const timer=setInterval(poll,2000),ticks=setInterval(()=>{if(connectedAt.current)setElapsed(Math.floor((Date.now()-connectedAt.current)/1000));},1000);
  return()=>{disposed=true;clearInterval(timer);clearInterval(ticks);const c=current.current;if(c)request(`/calls/${c.id}/end`,token,{device:device.current}).catch(()=>{});cleanup();};
 },[token]);
 useEffect(()=>()=>tones.current.close(),[]);
 useEffect(()=>{if(phase==='Разговор'&&screenReady&&call?.status==='active'&&cameraWanted.current&&!camera.current){cameraWanted.current=false;toggleCamera(true);}},[phase,screenReady,call?.status]);
 useEffect(()=>window.volnaDesktop?.onShowCall(()=>setMinimized(false)),[]);
 useEffect(()=>{if(remoteVideo.current&&remoteScreenStream.current)remoteVideo.current.srcObject=remoteScreenStream.current;},[call?.id,minimized,remoteSharing,videoMode]);
 useEffect(()=>{if(localVideo.current)localVideo.current.srcObject=camera.current;},[call?.id,minimized,cameraEnabled,videoMode]);
 const displayAvailable=typeof navigator.mediaDevices?.getDisplayMedia==='function';
 const duration=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
 return <><audio ref={remote} autoPlay playsInline/>{call&&<section className={'call-panel '+(minimized?'call-minimized':'')+(videoMode?' has-video':'')+(!controls&&videoMode?' controls-hidden':'')} role="dialog" aria-modal={!minimized} aria-label={minimized?'Звонок продолжается':call.video||call.peer_video?'Видеозвонок':'Аудиозвонок'}>{minimized?<><button className="call-mini-main" onClick={()=>setMinimized(false)} aria-label="Развернуть звонок"><Avatar name={call.peer?.name} id={call.peer?.id} src={call.peer?.avatar_url} token={token}/><span><strong>{call.peer?.name}</strong><small>{phase==='Разговор'?`Разговор · ${duration}`:phase}</small></span></button><button className="call-mini-hangup" onClick={end} aria-label="Завершить звонок"><Icon name="phone"/></button></>:<>{videoMode&&<div ref={stage} className={'call-video-stage '+(localMain?'local-main':'remote-main')} onClick={()=>setControls(v=>!v)} style={{'--preview-x':position.x,'--preview-y':position.y}}>
 <div className="call-video-status" role="status">{call.peer?.name} · {phase==='Разговор'?duration:phase}</div>
 <video ref={remoteVideo} className={'call-video-remote '+(!remoteSharing?'camera-hidden':'')} autoPlay playsInline/>
 <video ref={localVideo} className={'call-video-local '+(!cameraEnabled?'camera-hidden':'')+(front?' mirrored':'')} muted autoPlay playsInline/>
 {!remoteSharing&&<div className="call-video-remote video-placeholder"><Avatar name={call.peer?.name} id={call.peer?.id} src={call.peer?.avatar_url} token={token}/><span>Камера выключена</span></div>}
 {!cameraEnabled&&<div className="call-video-local video-placeholder"><span>Вы</span><span>Камера выключена</span></div>}
 <button className="call-preview-drag" aria-label="Переместить или поменять окна видео" onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={previewUp} onPointerCancel={()=>drag.current=null} onClick={e=>e.stopPropagation()}/>
 </div>}<header className="call-topbar"><span><i className={phase==='Разговор'?'call-live':''}/>{phase==='Разговор'?'Звонок':call.incoming?'Входящий звонок':'Аудиозвонок'}</span><span className="call-encryption">Защищённое соединение</span>{!(call.incoming&&call.status==='ringing')&&<button type="button" className="call-minimize" onClick={()=>setMinimized(true)} aria-label="Свернуть звонок, чтобы открыть переписку"><Icon name="minimize"/>Свернуть</button>}</header>{remoteSharing&&<div className="call-share-label">{call.peer_video?'Видео собеседника':'Собеседник демонстрирует экран'}</div>}<div className={'call-person '+(videoMode?'sharing-visible':'')}><div className="call-avatar"><Avatar name={call.peer?.name} id={call.peer?.id} src={call.peer?.avatar_url} token={token}/><span className={phase==='Разговор'?'call-pulse':''}/></div><h2>{call.peer?.name}</h2><p role="status">{phase}</p>{connectedAt.current>0&&<time>{duration}</time>}</div>{!relay&&<small className="call-warning">TURN не настроен: звонки через разные сети могут не соединяться.</small>}{soundBlocked&&<button className="call-sound-unblock" onClick={()=>remote.current.play().then(()=>setSoundBlocked(false)).catch(()=>onError('Разрешите воспроизведение звука в браузере'))}>Включить звук</button>}{call.incoming&&call.status==='ringing'?<div className="call-controls call-incoming"><button className="call-control decline" aria-label="Отклонить звонок" onClick={end}><b>×</b><span>Отклонить</span></button><button className="call-control accept" aria-label="Принять звонок" onClick={accept}><b>✓</b><span>Принять</span></button></div>:<><div className="call-controls">{hasAudio&&<button className={'call-control '+(muted?'selected':'')} aria-label={muted?'Включить микрофон':'Выключить микрофон'} aria-pressed={muted} onClick={()=>{stream.current?.getAudioTracks().forEach(t=>t.enabled=muted);setMuted(v=>!v);}}><b><Icon name={muted?'micOff':'mic'}/></b><span>{muted?'Включить микрофон':'Микрофон'}</span></button>}{hasAudio&&<button className={'call-control '+(cameraEnabled?'selected':'')} aria-label={cameraEnabled?'Выключить камеру':'Включить камеру'} aria-pressed={cameraEnabled} disabled={!screenReady||phase!=='Разговор'} onClick={()=>toggleCamera()}><b><Icon name="camera"/></b><span>{cameraEnabled?'Выкл. видео':'Вкл. видео'}</span></button>}{cameraEnabled&&<button className="call-control" aria-label="Сменить камеру" onClick={()=>toggleCamera(true,!front)}><b>↻</b><span>Камера</span></button>}{videoMode&&document.pictureInPictureEnabled&&<button className="call-control" aria-label="Маленькое окно" onClick={openPip}><b><Icon name="minimize"/></b><span>В окне</span></button>}{hasAudio&&<button className={'call-control share '+(sharing?'selected':'')} aria-label={sharing?'Остановить демонстрацию экрана':'Показать экран'} aria-pressed={sharing} disabled={!displayAvailable||!screenReady||phase!=='Разговор'} title={!displayAvailable?'Демонстрация недоступна в этом браузере':!screenReady?'Для демонстрации экрана нужна обновлённая версия у обоих участников':'Начать или завершить демонстрацию'} onClick={toggleScreenShare}><b><Icon name="screen"/></b><span>{sharing?'Остановить показ':'Показать экран'}</span></button>}<button className="call-control hangup" aria-label="Завершить звонок" onClick={end}><b><Icon name="phone"/></b><span>Завершить</span></button></div><AudioOutput audioRef={remote} active={hasAudio}/></>}{phase==='Разговор'&&<small className="call-background-hint">Звонок продолжится при выключенном экране, пока приложение работает в фоне.</small>}</>}</section>}</>;

});
