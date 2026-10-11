import React,{useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
const stack=[];
export default function Dialog({title,onClose,className='',children,inline=false,closeLabel,heading}){
 const ref=useRef(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(inline)return;
  const node=ref.current,previous=document.activeElement;stack.push(node);
  const top=()=>stack.at(-1)===node;
  if(!node.contains(document.activeElement))node.focus();
  const key=e=>{
   if(!top()||e.defaultPrevented)return;
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close.current();return;}
   if(e.key==='Tab'){
    const nodes=[...node.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
    if(!nodes.length){e.preventDefault();node.focus();return;}
    const first=nodes[0],last=nodes.at(-1),active=document.activeElement;
    if(e.shiftKey&&(active===first||active===node||!node.contains(active))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(active===last||active===node||!node.contains(active))){e.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{const wasTop=top();stack.splice(stack.indexOf(node),1);document.removeEventListener('keydown',key);if(wasTop&&previous?.isConnected)previous.focus();};
 },[inline]);
 if(inline)return <section className={'settings-page '+className}>{children}</section>;
 const view=<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&stack.at(-1)===ref.current)onClose();}}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e=>{if(e.key==='Escape'&&stack.at(-1)===ref.current){e.preventDefault();e.stopPropagation();close.current();}}} tabIndex={-1} className={'modal '+className}><header><h2>{heading||title}</h2><button className="icon-button" aria-label={closeLabel||'Закрыть '+title} onClick={onClose}><Icon name="close"/></button></header>{children}</section></div>;
 return typeof document==='undefined'?view:createPortal(view,document.body);
}
