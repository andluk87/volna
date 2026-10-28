import React,{useLayoutEffect,useRef,useState} from 'react';
import Dialog from './Dialog';
import {Icon} from './ui';
import {quoteFromSelection} from './reply-selection.mjs';
export default function ReplyQuoteDialog({message,chats,initial,onClose,onApply,onRemove,onShow,onMove}){
 const text=useRef(null),[quote,setQuote]=useState(initial||null),[moving,setMoving]=useState(false);
 useLayoutEffect(()=>{
  if(!initial||!text.current?.firstChild)return;
  const range=document.createRange(),node=text.current.firstChild;
  if(initial.offset+initial.text.length>node.length)return;
  range.setStart(node,initial.offset);range.setEnd(node,initial.offset+initial.text.length);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
 },[]);
 const selected=()=>{const next=quoteFromSelection(text.current,message.text,window.getSelection());if(next)setQuote(next);};
 return <Dialog title="Изменение цитаты" className="reply-quote-dialog" onClose={onClose}>
  <div className="quote-source-wrap"><div ref={text} className="quote-source-text" tabIndex={0} onMouseUp={selected} onKeyUp={selected} onTouchEnd={selected}>{message.text}</div></div>
  {quote&&<p className="quote-selected-preview">{quote.text}</p>}
  <div className="quote-dialog-actions">
   <button onClick={()=>setMoving(v=>!v)}><Icon name="forward"/>Ответить в другом чате</button>
   {moving&&<div className="forward-targets">{chats.filter(c=>c.can_send!==0).map(c=><button key={c.id} disabled={!quote} onClick={()=>onMove(c.id,quote)}>{c.name}</button>)}</div>}
   <button onClick={onShow}><Icon name="search"/>Показать в чате</button>
   <button className="danger" onClick={onRemove}><Icon name="trash"/>Убрать ответ</button>
  </div>
  <p className="quote-help">Вы можете процитировать фрагмент текста. До 1024 символов.</p>
  <footer><button onClick={onClose}>Отмена</button><button disabled={!quote} onClick={()=>onApply(quote)}>Цитировать фрагмент</button></footer>
 </Dialog>;
}
