import {useEffect,useRef,useState} from 'react';
import {clampCallPosition} from './call-position.mjs';
export default function useCallPosition(minimized,callId) {
 const panel=useRef(null),drag=useRef(null),suppress=useRef(false),[position,setPosition]=useState(null);
 const clamp=p=>clampCallPosition(p,{width:innerWidth,height:innerHeight},panel.current?.getBoundingClientRect()||{width:360,height:80});
 useEffect(()=>{setPosition(null);drag.current=null;suppress.current=false;},[callId]);
 useEffect(()=>{if(!minimized)return;const resize=()=>setPosition(p=>p?clamp(p):p);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[minimized]);
 function down(e){if(!minimized||e.button!==0||e.target.closest('.call-mini-hangup'))return;const rect=panel.current.getBoundingClientRect(),capture=e.target.closest('button')||panel.current;capture.setPointerCapture(e.pointerId);suppress.current=false;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false,capture};}
 function move(e){const d=drag.current;if(!d||e.pointerId!==d.id)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.moved&&Math.hypot(dx,dy)<6)return;if(!d.moved)d.moved=true;setPosition(clamp({x:d.left+dx,y:d.top+dy}));}
 function up(e){const d=drag.current;if(!d||d.id!==e.pointerId)return;suppress.current=d.moved;drag.current=null;if(d.capture.hasPointerCapture(e.pointerId))d.capture.releasePointerCapture(e.pointerId);}
 function click(e){if(suppress.current){e.preventDefault();e.stopPropagation();suppress.current=false;}}
 function key(e){const deltas={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(!deltas[e.key])return;e.preventDefault();const r=panel.current.getBoundingClientRect(),[dx,dy]=deltas[e.key];setPosition(clamp({x:r.left+dx,y:r.top+dy}));}
 return {panel,style:minimized&&position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:undefined,handlers:{onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up,onClickCapture:click},key};
}
