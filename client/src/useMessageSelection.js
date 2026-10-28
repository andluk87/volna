import {useEffect,useRef} from 'react';
// Text-origin drags belong to the browser; gutter drags and modifiers select message ranges.
export default function useMessageSelection(messages,selectedIds,setSelectedIds){
 const gesture=useRef(null),anchor=useRef(null),suppressClick=useRef(false),textGesture=useRef(false);
 useEffect(()=>{const finish=()=>{if(gesture.current?.dragging){suppressClick.current=true;anchor.current=gesture.current.id;}gesture.current=null;};window.addEventListener('pointerup',finish);window.addEventListener('blur',finish);return()=>{window.removeEventListener('pointerup',finish);window.removeEventListener('blur',finish);};},[]);
 const eligible=messages.filter(m=>!m.deleted_at),ids=eligible.map(m=>String(m.id));
 const article=target=>target.closest?.('[data-message-id]:not(.deleted)');
 const interactive=target=>target.closest('button,a,input,textarea,summary,video,audio,[contenteditable=true]');
 function nearest(e){const direct=article(e.target);if(direct)return direct;let best=null,distance=Infinity;for(const node of e.currentTarget.querySelectorAll('[data-message-id]:not(.deleted)')){const r=node.getBoundingClientRect(),d=e.clientY<r.top?r.top-e.clientY:e.clientY>r.bottom?e.clientY-r.bottom:0;if(d<distance){best=node;distance=d;}}return best;}
 function range(from,to){const a=ids.indexOf(from),b=ids.indexOf(to);return a<0||b<0?[]:eligible.slice(Math.min(a,b),Math.max(a,b)+1).map(m=>m.id);}
 return {
  onPointerDown:e=>{suppressClick.current=false;textGesture.current=false;if(e.button!==0||e.pointerType!=='mouse'||interactive(e.target))return;gesture.current=null;if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.target.closest('.message-text')){textGesture.current=true;return;}const row=nearest(e);if(!row)return;gesture.current={id:row.dataset.messageId,x:e.clientX,y:e.clientY,outside:!article(e.target),base:new Set(selectedIds)};},
  onPointerMove:e=>{const g=gesture.current;if(!g)return;if(!(e.buttons&1)){gesture.current=null;return;}if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<5&&!g.dragging)return;const row=nearest(e);if(!row||row.dataset.messageId===g.id&&!g.dragging&&!g.outside)return;g.dragging=true;e.preventDefault();window.getSelection()?.removeAllRanges();setSelectedIds(new Set([...g.base,...range(g.id,row.dataset.messageId)]));const bounds=e.currentTarget.getBoundingClientRect();if(e.clientY<bounds.top+30)e.currentTarget.scrollTop-=12;else if(e.clientY>bounds.bottom-30)e.currentTarget.scrollTop+=12;},
  onPointerUp:()=>{if(gesture.current?.dragging){suppressClick.current=true;anchor.current=gesture.current.id;}gesture.current=null;},
  onPointerCancel:()=>{gesture.current=null;},
  onClickCapture:e=>{if(textGesture.current)return;if(suppressClick.current){suppressClick.current=false;e.preventDefault();e.stopPropagation();return;}if(interactive(e.target))return;const row=article(e.target);if(!row)return;const id=row.dataset.messageId;if(e.shiftKey&&anchor.current){e.preventDefault();window.getSelection()?.removeAllRanges();setSelectedIds(new Set([...selectedIds,...range(anchor.current,id)]));}else if(selectedIds.size||e.ctrlKey||e.metaKey){e.preventDefault();const message=eligible.find(m=>String(m.id)===id);if(!message)return;setSelectedIds(previous=>{const next=new Set(previous);if(next.has(message.id))next.delete(message.id);else next.add(message.id);return next;});anchor.current=id;}else anchor.current=id;}
 };
}
