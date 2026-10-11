import {useState,useEffect,useRef} from 'react';
import {columnLayout} from './column-layout.mjs';
export default function useColumnLayout(){
 const desktop=!!window.volnaDesktop,key='volna.columns.'+(desktop?'desktop':'web');
 const [viewport,setViewport]=useState(()=>window.innerWidth||1440),[preferred,setPreferred]=useState(()=>{try{const value=Number(localStorage.getItem(key));return value>0?value:null;}catch{return null;}}),[resizing,setResizing]=useState(false);
 const drag=useRef(null),layout=columnLayout(viewport,desktop,preferred);
 useEffect(()=>{const resize=()=>setViewport(innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>()=>{document.documentElement.classList.remove('columns-resizing');},[]);
 function save(value){setPreferred(value);try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,String(value));}catch{}}
 function finish(e){if(!drag.current||e.pointerId!==drag.current.id)return;const value=drag.current.value;drag.current=null;setResizing(false);document.documentElement.classList.remove('columns-resizing');save(value);}
 return {layout,resizing,style:{'--sidebar-width':layout.sidebar+'px'},separator:{
  role:'separator',tabIndex:0,'aria-label':'Ширина списка чатов','aria-orientation':'vertical','aria-valuemin':layout.min,'aria-valuemax':layout.max,'aria-valuenow':Math.round(layout.sidebar),
  onPointerDown:e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,width:layout.sidebar,value:layout.sidebar};setResizing(true);document.documentElement.classList.add('columns-resizing');},
  onPointerMove:e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const next=columnLayout(innerWidth,desktop,d.width+e.clientX-d.x).sidebar;d.value=next;setPreferred(next);},
  onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,onDoubleClick:()=>save(null),
  onKeyDown:e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();save(e.key==='Home'?layout.min:e.key==='End'?layout.max:layout.sidebar+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?40:10));}}
 }};
}
