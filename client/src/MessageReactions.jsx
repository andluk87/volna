import React from 'react';
import {Avatar} from './ui';
export default function MessageReactions({message:m,meId,token,onReact,onPeople}){
 return <div className="reactions">{[...new Set(m.reactions.map(r=>r.emoji))].map(emoji=><button key={emoji} aria-label={'Реакция '+emoji} aria-pressed={m.reactions.some(r=>r.emoji===emoji&&r.user_id===meId)} className={m.reactions.some(r=>r.emoji===emoji&&r.user_id===meId)?'mine':''} onMouseDown={e=>e.preventDefault()} onContextMenu={e=>{e.preventDefault();onPeople(m.id,emoji);}} onClick={()=>onReact(m,emoji,!m.reactions.some(r=>r.emoji===emoji&&r.user_id===meId))}><span>{emoji}</span><span className="reaction-avatars">{m.reactions.filter(r=>r.emoji===emoji).slice(0,3).map(r=><Avatar key={r.user_id} id={r.user_id} name={r.name} src={r.avatar_url} token={token}/>)}</span>{m.reactions.filter(r=>r.emoji===emoji).length>3&&<small>+{m.reactions.filter(r=>r.emoji===emoji).length-3}</small>}</button>)}</div>;
}
