import React,{useState} from 'react';
import Dialog from './Dialog';
import {Icon} from './ui';
export default function ChecklistDialog({onClose,onSend,busy}){
 const [title,setTitle]=useState(''),[items,setItems]=useState(['']);
 const valid=title.trim()&&items.length&&items.every(text=>text.trim());
 return <Dialog title="Новый список" onClose={onClose}><form className="poll-editor" onSubmit={e=>{e.preventDefault();if(valid)onSend({title:title.trim(),items:items.map(text=>({text:text.trim()}))});}}><label>Название<input autoFocus aria-label="Название списка" required maxLength={255} value={title} onChange={e=>setTitle(e.target.value)}/></label><h3>Пункты списка</h3>{items.map((text,index)=><div key={index}><input required aria-label={'Пункт списка '+(index+1)} maxLength={200} value={text} onChange={e=>setItems(current=>current.map((value,i)=>i===index?e.target.value:value))}/>{items.length>1&&<button type="button" aria-label={'Убрать пункт '+(index+1)} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}><Icon name="close"/></button>}</div>)}{items.length<30&&<button type="button" className="secondary" onClick={()=>setItems(current=>[...current,''])}>Добавить пункт</button>}<small>Участники с правом отправки сообщений могут отмечать выполненные пункты.</small><button className="primary" disabled={busy||!valid}>Отправить список</button></form></Dialog>;
}
