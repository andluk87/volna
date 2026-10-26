import React,{useEffect,useRef,useState} from 'react';
import StandardEmojiText from './StandardEmojiText';
import {loadEmojiAnimation,loadEmojiPlayer} from './animated-emoji.mjs';
import './animated-emoji.css';

export default function AnimatedEmoji({emoji,file,autoplay=true}){
 const root=useRef(null),surface=useRef(null),replay=useRef(()=>{}),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let disposed=false,animation,loading=false,visible=false,loaded=false,started=false,finished=false,manual=false;
  setReady(false);setFailed(false);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function sync(){
   if(!loaded)return;
   if(!visible||document.hidden){animation.pause();return;}
   if(!manual&&(!autoplay||reduced.matches)){animation.pause();return;}
   if(!started){started=true;animation.goToAndPlay(0,true);}
   else if(!finished)animation.play();
  }
  function fail(){if(disposed)return;loaded=false;animation?.destroy();animation=null;setReady(false);setFailed(true);}
  async function load(){
   if(loading||disposed)return;
   loading=true;
   try{
    const [lottie,data]=await Promise.all([loadEmojiPlayer(),loadEmojiAnimation(file)]);
    if(disposed)return;
    // Lottie mutates animation data; each message needs an independent copy.
    animation=lottie.loadAnimation({container:surface.current,renderer:'svg',loop:false,autoplay:false,animationData:structuredClone(data),rendererSettings:{preserveAspectRatio:'xMidYMid meet'}});
    animation.addEventListener('data_failed',fail);
    animation.addEventListener('error',fail);
    animation.addEventListener('complete',()=>{finished=true;manual=false;});
    function onReady(){if(disposed||loaded)return;loaded=true;animation.goToAndStop(0,true);setReady(true);sync();}
    animation.addEventListener('DOMLoaded',onReady);
    if(animation.isLoaded)onReady();
   }catch{fail();}
  }
  replay.current=()=>{
   manual=true;finished=false;started=false;
   load();sync();
  };
  const observer=new IntersectionObserver(entries=>{
   visible=entries[0].isIntersecting;
   if(visible)load();
   sync();
  });
  observer.observe(root.current);
  const motionChanged=()=>{if(reduced.matches){manual=false;animation?.pause();}else sync();};
  reduced.addEventListener('change',motionChanged);
  document.addEventListener('visibilitychange',sync);
  return()=>{disposed=true;replay.current=()=>{};observer.disconnect();reduced.removeEventListener('change',motionChanged);document.removeEventListener('visibilitychange',sync);animation?.destroy();};
 },[emoji,file,autoplay]);
 return <button ref={root} type="button" className={'animated-emoji'+(ready?' is-ready':'')} disabled={failed} aria-label={'Воспроизвести анимацию '+emoji} data-emoji-fallback={emoji} onClick={event=>{event.stopPropagation();replay.current();}}>
  <span className="animated-emoji-fallback" aria-hidden="true"><StandardEmojiText text={emoji}/></span>
  <span ref={surface} className="animated-emoji-surface" aria-hidden="true"/>
 </button>;
}
