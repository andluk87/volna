import {useRef} from 'react';
// Cross-bubble mouse drags select messages; a drag within one bubble still selects text.
export default function useMessageSelection(messages,selectedIds,setSelectedIds){
 const gesture=useRef(null),anchor=useRef(null),suppressClick=useRef(false);
 const eligible=messages.filter(m=>!m.deleted_at),ids=eligible.map(m=>String(m.id));
 const article=target=>target.closest?.('[data-message-id]:not(.deleted)');
 function range(from,to){const a=ids.indexOf(from),b=ids.indexOf(to);return a<0||b<0?[]:eligible.slice(Math.min(a,b),Math.max(a,b)+1).map(m=>m.id);}
 return {
  onPointerDown:e=>{suppressClick.current=false;if(e.button!==0||e.pointerType!=='mouse'||e.target.closest('button,a,input,textarea,summary,video,audio'))return;const row=article(e.target);if(!row)return;gesture.current={id:row.dataset.messageId,base:new Set(selectedIds)};},
  onPointerMove:e=>{const g=gesture.current;if(!g)return;if(!(e.buttons&1)){gesture.current=null;return;}const row=article(e.target);if(!row||row.dataset.messageId===g.id&&!g.dragging)return;g.dragging=true;e.preventDefault();window.getSelection()?.removeAllRanges();setSelectedIds(new Set([...g.base,...range(g.id,row.dataset.messageId)]));},
  onPointerUp:()=>{if(gesture.current?.dragging){suppressClick.current=true;anchor.current=gesture.current.id;}gesture.current=null;},
  onPointerCancel:()=>{gesture.current=null;},
  onClickCapture:e=>{if(suppressClick.current){suppressClick.current=false;e.preventDefault();e.stopPropagation();return;}if(e.target.closest('button,a,input,textarea,summary,video,audio'))return;const row=article(e.target);if(!row)return;const id=row.dataset.messageId;if(e.shiftKey&&anchor.current){e.preventDefault();window.getSelection()?.removeAllRanges();setSelectedIds(new Set([...selectedIds,...range(anchor.current,id)]));}else if(selectedIds.size||e.ctrlKey||e.metaKey){e.preventDefault();const message=eligible.find(m=>String(m.id)===id);setSelectedIds(previous=>{const next=new Set(previous);if(next.has(message.id))next.delete(message.id);else next.add(message.id);return next;});anchor.current=id;}else anchor.current=id;}
 };
}
