import React,{useCallback,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
import EmojiPicker from './EmojiPicker';
import {fitMessagePopup} from './message-popup.mjs';
import './message-popup.css';

export default function MessageMenu({message,quickReactions,meId,canSend,canManage,canDelete,onReact,onSelect,onCopy,onReply,onForward,onSave,onPin,onEdit,onDelete}){
 const owner=useRef(null),popup=useRef(null),[point,setPoint]=useState({x:0,y:0}),id=useId(),[open,setOpen]=useState(false),[expanded,setExpanded]=useState(false),previousExpanded=useRef(false);
 const close=useCallback(()=>{if(owner.current)owner.current.open=false;setOpen(false);setExpanded(false);previousExpanded.current=false;},[]);
 const collapse=useCallback(()=>setExpanded(false),[]);
 const react=emoji=>{close();onReact(emoji);};
 const show=useCallback(details=>{
  for(const other of document.querySelectorAll('.message-actions[open]'))if(other!==details)other.open=false;
  const anchor=details.getBoundingClientRect(),x=Number(details.dataset.menuX),y=Number(details.dataset.menuY);
  setPoint(details.dataset.menuX&&details.dataset.menuY?{x,y}:{x:anchor.right,y:anchor.bottom});
  previousExpanded.current=false;setExpanded(false);setOpen(true);
 },[]);
 const toggle=event=>{
  const details=event.currentTarget;
  if(details.open)show(details);else{setOpen(false);setExpanded(false);previousExpanded.current=false;}
  delete details.dataset.menuX;delete details.dataset.menuY;
 };
 useLayoutEffect(()=>{
  const details=owner.current,requested=()=>show(details);
  details.addEventListener('volna-message-menu-open',requested);
  return()=>details.removeEventListener('volna-message-menu-open',requested);
 },[show]);
 useLayoutEffect(()=>{
  if(!open||!popup.current)return;
  const root=popup.current,details=owner.current;
  const position=()=>{
   const viewport=window.visualViewport;
   const size={viewportTop:document.querySelector('.desktop-titlebar')?.getBoundingClientRect().bottom||0,x:point.x,y:point.y,width:expanded?320:268,height:0,viewportWidth:viewport?.width||innerWidth,viewportHeight:viewport?.height||innerHeight,bounds:details.closest('.conversation')?.getBoundingClientRect()};
   const initial=fitMessagePopup(size);root.style.width=initial.width+'px';root.style.maxHeight=initial.maxHeight+'px';
   const fitted=fitMessagePopup({...size,height:root.getBoundingClientRect().height});
   root.style.left=fitted.left+'px';root.style.top=fitted.top+'px';root.dataset.positioned='true';
  };
  position();const observer=new ResizeObserver(position);observer.observe(root);window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
  const focus=expanded?root.querySelector('input'):previousExpanded.current?root.querySelector('.reaction-expand'):root.querySelector('.message-menu>button');
  focus?.focus({preventScroll:true});previousExpanded.current=expanded;
  const escape=event=>{if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();if(expanded)setExpanded(false);else{close();details.querySelector('summary')?.focus({preventScroll:true});}};
  window.addEventListener('keydown',escape,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.removeEventListener('keydown',escape,true);};
 },[open,expanded,close,point]);
 const action=(callback)=>()=>{close();callback();};
 const own=message.sender_id===meId;
 return <><details ref={owner} className="message-actions" data-menu-owner={id} onToggle={toggle}>
  <summary aria-label={'Действия сообщения '+message.id} aria-expanded={open}><Icon name="more"/></summary>
 </details>{open&&createPortal(<div ref={popup} className={'message-popup'+(expanded?' message-popup-expanded':'')} data-message-menu-owner={id}>
  {expanded?<EmojiPicker reaction onPick={react} onClose={collapse}/>:<>
   <div className="reaction-picker message-quick-reactions" role="toolbar" aria-label="Быстрые реакции">
    {quickReactions.slice(0,6).map(emoji=><button type="button" key={emoji} aria-label={'Реакция '+emoji} aria-pressed={message.reactions?.some(r=>r.emoji===emoji&&r.user_id===meId)||false} onClick={()=>react(emoji)}>{emoji}</button>)}
    <button type="button" className="reaction-expand" aria-label="Другие реакции" title="Другие реакции" aria-expanded={expanded} onClick={()=>setExpanded(true)}><Icon name="down"/></button>
   </div>
   <div className="message-menu" role="menu" aria-label="Действия сообщения">
    {canSend&&<button type="button" role="menuitem" onClick={action(onReply)}><Icon name="reply"/>Ответить</button>}
    {canManage&&<button type="button" role="menuitem" onClick={action(onPin)}><Icon name="pin"/>{message.pinned?'Открепить':'Закрепить'}</button>}
    <button type="button" role="menuitem" onClick={action(onCopy)}><Icon name="copy"/>Копировать</button>
    <button type="button" role="menuitem" onClick={action(onForward)}><Icon name="forward"/>Переслать</button>
    <button type="button" role="menuitem" onClick={action(onSave)}><Icon name="bookmark"/>В избранное</button>
    {own&&canSend&&!message.poll&&!message.checklist&&<button type="button" role="menuitem" onClick={action(onEdit)}><Icon name="edit"/>Редактировать</button>}
    {canDelete&&<button type="button" role="menuitem" className="danger" onClick={action(onDelete)}><Icon name="trash"/>Удалить у всех</button>}
    <button type="button" role="menuitem" onClick={action(onSelect)}><Icon name="check"/>Выбрать</button>
   </div>
  </>}
 </div>,document.body)}</>;
}
