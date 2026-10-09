import React,{useState} from 'react';
import Dialog from './Dialog';
import {Icon} from './ui';
export default function PollDialog({onClose,onSend,busy}){
 const [question,setQuestion]=useState(''),[options,setOptions]=useState(['','']);
 const valid=question.trim()&&options.length>=2&&options.every(o=>o.trim())&&new Set(options.map(o=>o.trim().toLowerCase())).size===options.length;
 return <Dialog title="Новый опрос" onClose={onClose}><form className="poll-editor" onSubmit={e=>{e.preventDefault();if(valid)onSend({question:question.trim(),options:options.map(text=>({text:text.trim(),voters:[]}))});}}><label>Вопрос<input autoFocus aria-label="Вопрос опроса" required maxLength={255} value={question} onChange={e=>setQuestion(e.target.value)}/></label><h3>Варианты ответа</h3>{options.map((o,i)=><div key={i}><input required aria-label={'Вариант ответа '+(i+1)} maxLength={100} value={o} onChange={e=>setOptions(a=>a.map((v,n)=>n===i?e.target.value:v))}/>{options.length>2&&<button type="button" aria-label={'Убрать вариант '+(i+1)} onClick={()=>setOptions(a=>a.filter((_,n)=>n!==i))}><Icon name="close"/></button>}</div>)}{options.length<10&&<button type="button" className="secondary" onClick={()=>setOptions(a=>[...a,''])}>Добавить вариант</button>}<small>Опрос доступен в локальной демонстрации. Голоса остаются в этой вкладке.</small><button className="primary" disabled={busy||!valid}>Отправить опрос</button></form></Dialog>;
}
