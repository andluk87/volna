import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './ui';
import './composer-emoji-button.css';
const defaults=['😀','😂','😊','🥰','😍','😘','😎','🤔','👍','👎','❤️','🔥','👏','🎉','🙏','🤝','💯','😢','🙌','👌','👀','💪','✨','✅'];
function quickEmoji(){try{const saved=JSON.parse(localStorage.getItem('volna.emoji')||'[]');return [...new Set([...(Array.isArray(saved)?saved.filter(e=>typeof e==='string'&&e.length<=32):[]),...defaults])].slice(0,24);}catch{return defaults;}}
export default function ComposerEmojiButton({expanded,disabled,onToggle,onPick,renderPicker}){
 const [hover,setHover]=useState(false),[items,setItems]=useState(quickEmoji),timer=useRef(null),root=useRef(null);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(expanded||disabled)setHover(false);},[expanded,disabled]);
 useEffect(()=>{if(!hover)return;const dismiss=e=>{if(e.type==='keydown'?e.key==='Escape':!root.current?.contains(e.target)){if(e.type==='keydown'){e.preventDefault();e.stopPropagation();if(root.current?.contains(document.activeElement))root.current?.querySelector('button')?.focus();}setHover(false);}};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss,true);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss,true);};},[hover]);
 function enter(e){if(e.pointerType!=='mouse'||!window.volnaDesktop||expanded||disabled)return;clearTimeout(timer.current);setItems(quickEmoji());setHover(true);}
 function leave(){clearTimeout(timer.current);timer.current=setTimeout(()=>setHover(false),160);}
 function pick(emoji){onPick(emoji);const next=[emoji,...quickEmoji().filter(x=>x!==emoji)].slice(0,18);try{localStorage.setItem('volna.emoji',JSON.stringify(next));}catch{}setItems(quickEmoji());}
 return <div className="composer-emoji-control" ref={root} onPointerEnter={enter} onPointerLeave={leave}><button type="button" className="icon-button composer-emoji" aria-label="Эмодзи" aria-expanded={expanded||hover} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{clearTimeout(timer.current);setHover(false);onToggle();}}><Icon name="smile"/></button>{hover&&!expanded&&!disabled&&<section className="quick-emoji-popup" aria-label="Быстрый выбор эмодзи" onPointerEnter={()=>clearTimeout(timer.current)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setHover(false);root.current?.querySelector('button')?.focus();}}}>{renderPicker?renderPicker(()=>setHover(false)):<><div className="quick-emoji-grid">{items.map(emoji=><button key={emoji} type="button" aria-label={'Вставить '+emoji} onMouseDown={e=>e.preventDefault()} onClick={()=>pick(emoji)}>{emoji}</button>)}</div><button type="button" className="quick-emoji-more" onMouseDown={e=>e.preventDefault()} onClick={()=>{setHover(false);onToggle();}}>Все эмодзи</button></>}</section>}</div>;
}
