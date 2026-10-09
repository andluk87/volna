import React,{useEffect,useState} from 'react';
import {Icon} from './ui';
export default function RecordingBar({stream,paused,seconds,onPause,onStop,onCancel}){
 const [wave,setWave]=useState(Array(24).fill(.05));
 useEffect(()=>{if(!stream)return;let context,timer;try{context=new AudioContext();const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);const data=new Uint8Array(256);timer=setInterval(()=>{analyser.getByteTimeDomainData(data);let max=0;for(const n of data)max=Math.max(max,Math.abs(n-128)/128);setWave(w=>[...w.slice(1),Math.max(.05,max)]);},100);}catch{}return()=>{clearInterval(timer);context?.close().catch(()=>{});};},[stream]);
 return <div className="recording-bar"><button type="button" aria-label="Отменить голосовое" onClick={onCancel}><Icon name="close"/></button><span className="recording"><i/> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span><div className="record-wave" aria-hidden="true">{wave.map((n,i)=><i key={i} style={{height:n*28+'px'}}/>)}</div></div>;
}
