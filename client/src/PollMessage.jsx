import React,{useState} from 'react';
import {Icon} from './ui';
export default function PollMessage({poll,onVote,userId}){
 const [busy,setBusy]=useState(false),voted=poll.options.some(o=>o.voters.includes(userId)),total=poll.options.reduce((n,o)=>n+o.voters.length,0);
 async function vote(option){if(busy)return;setBusy(true);try{await onVote(option);}finally{setBusy(false);}}
 return <section className="poll-message" aria-label="Опрос"><strong>{poll.question}</strong><small>Опрос · один ответ</small><div>{poll.options.map((o,index)=>{const selected=o.voters.includes(userId),percent=total?Math.round(o.voters.length/total*100):0;return <button key={index} type="button" disabled={busy} aria-pressed={selected} onClick={()=>vote(index)}><span className={'poll-choice '+(selected?'chosen':'')}>{selected&&<Icon name="check"/>}</span><span className="poll-option-text">{o.text}{voted&&<span className="poll-result"><i style={{width:percent+'%'}}/></span>}</span>{voted&&<b>{percent}%</b>}</button>;})}</div><footer>{voted&&<button type="button" disabled={busy} onClick={()=>vote(null)}>Отменить голос</button>}<span>{total} голосов</span></footer></section>;
}
