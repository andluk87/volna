import React,{useState} from 'react';
export default function ChecklistMessage({checklist,onCheck,canCheck}){
 const [busy,setBusy]=useState(false);
 const done=checklist.items.filter(item=>item.done).length;
 return <section className="checklist-message" aria-label="Список"><strong>{checklist.title}</strong><div>{checklist.items.map((item,index)=><label key={index} className={item.done?'completed':''}><input type="checkbox" aria-label={item.text} checked={item.done} disabled={busy||!canCheck} onChange={async e=>{setBusy(true);try{await onCheck(index,e.target.checked);}finally{setBusy(false);}}}/><span>{item.text}</span></label>)}</div><small>Выполнено {done} из {checklist.items.length}</small></section>;
}
