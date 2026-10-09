import React,{useEffect,useState,useRef} from 'react';
import {Capacitor} from '@capacitor/core';
import {Icon} from './ui';
import {fileBlob} from './api';
import AudioPlayer from './AudioPlayer';
import PhotoViewer from './PhotoViewer';
import {shareMedia} from './media';
export default function Attachment({file,token,gallery=[],messageId=null,transcript='',expressionKind=null}){
 const root=useRef(null),[visible,setVisible]=useState(()=>typeof IntersectionObserver!=='function');
 useEffect(()=>{if(visible||typeof IntersectionObserver!=='function')return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[visible]);
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(false),[preview,setPreview]=useState(false),[sharing,setSharing]=useState(false);
 const photo=file.mime.startsWith('image/'),audio=file.mime.startsWith('audio/'),voice=audio&&file.name.startsWith('Голосовое-');
 const expression=expressionKind==='sticker'||expressionKind==='gif';
 const auto=(photo||audio||expression)&&file.size<=(expression?10:5)*1024*1024;
 useEffect(()=>{let object;const controller=new AbortController();if(auto&&visible||attempt){setLoading(true);fileBlob(file.id,token,controller.signal).then(blob=>{object=URL.createObjectURL(blob);setUrl(object);setError('');}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});}return()=>{controller.abort();if(object)URL.revokeObjectURL(object);};},[file.id,token,attempt,auto,visible]);
 async function share(){setSharing(true);try{await shareMedia(url,file);}catch(e){setError(e.message||'Не удалось открыть файл');}finally{setSharing(false);}}
 const download=url&&(Capacitor.isNativePlatform()?<button disabled={sharing} onClick={share}>{sharing?'Подготовка…':'Сохранить'}</button>:<a href={url} download={file.name}>Скачать</a>);
 return <div ref={root} className={'attachment '+(photo?'photo-attachment':audio?'audio-attachment':'document-attachment')+(expression?' expression-attachment':'')}>
 {error&&<button className="media-error" onClick={()=>setAttempt(v=>v+1)}>Повторить: {error}</button>}
 {photo&&(url?<button className="image-open" aria-label={'Открыть изображение '+file.name} onClick={()=>setPreview(true)}><img src={url} alt={file.name} loading="lazy" onError={()=>setError('Изображение не поддерживается')}/></button>:<button className="photo-placeholder" disabled={loading} onClick={()=>setAttempt(v=>v+1)}><Icon name="photo"/>{loading?'Загружаем фото…':'Загрузить фото'}</button>)}
 {audio&&(url?<AudioPlayer url={url} name={file.name} voice={voice} messageId={voice?messageId:null} token={token} transcript={voice?transcript:''}/>:<button className="voice-placeholder" disabled={loading} onClick={()=>setAttempt(v=>v+1)}><Icon name="play"/>{loading?'Загрузка аудио…':voice?'Загрузить голосовое':'Загрузить аудио'}</button>)}
 {!url&&file.mime.startsWith('video/')&&!expression&&<button className="video-placeholder" aria-label={'Загрузить видео '+file.name} disabled={loading} onClick={()=>setAttempt(v=>v+1)}><Icon name="play"/><span>{loading?'Загрузка видео…':'Нажмите, чтобы загрузить видео'}</span></button>}
 {url&&file.mime.startsWith('video/')&&<video src={url} controls={!expression} autoPlay={expression} loop={expression} muted={expression} playsInline preload="metadata"/>}
 {!photo&&!audio&&!expression&&<div className="file-label"><span><Icon name="clip"/> {file.name}<small>{(file.size/1024).toFixed(1)} КБ</small></span>{download||<button disabled={loading} onClick={()=>setAttempt(v=>v+1)}>{loading?'Загрузка…':'Загрузить'}</button>}</div>}
 {expression&&!url&&!photo&&<button disabled={loading} onClick={()=>setAttempt(v=>v+1)}>{loading?'Загрузка…':'Загрузить анимацию'}</button>}
 {audio&&url&&<details className="media-save"><summary aria-label="Сохранить аудио">Сохранить</summary>{download}</details>}
 {preview&&<PhotoViewer file={file} gallery={gallery} token={token} onClose={()=>setPreview(false)}/>}
 </div>;
}
