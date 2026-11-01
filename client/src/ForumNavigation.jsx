import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {request} from './api';
import {Icon} from './ui';
import './forum-desktop.css';
export function useForumInfo(group,token,revision){
 const [info,setInfo]=useState(null);
 useEffect(()=>{if(!group||!token){setInfo(null);return;}const c=new AbortController();request(`/groups/${group}/topics`,token,undefined,c.signal).then(v=>setInfo({...v,group_id:group})).catch(e=>{if(e.name!=='AbortError')setInfo(null);});return()=>c.abort();},[group,token,revision]);
 return info?.group_id===group?info:null;
}
export default function ForumNavigation({info,group,active,all,onSelect,onAll,onManage,onCreate=onManage,onSettings,open,onBack}){
 const [target,setTarget]=useState(null),[query,setQuery]=useState('');
 useEffect(()=>setTarget(document.querySelector('.sidebar:not(.settings-sidebar)')),[group?.id,info?.layout]);
 if(!info?.enabled||!group)return null;
 const rows=[info.general,...info.topics].filter(t=>t&&!t.hidden).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(a.pinned?a.pin_order-b.pin_order:0));
 const buttons=rows.filter(t=>!query||t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(t=><button key={t.id} className={'forum-navigation-topic '+(!all&&active===t.id?'selected':'')} aria-current={!all&&active===t.id?'page':undefined} onClick={()=>onSelect(t.id)}><span className="forum-topic-icon">{t.general?'#':t.icon||'💬'}</span><span className="forum-topic-copy"><strong>{t.name}</strong><small>{t.last_text||t.description||'Пока нет сообщений'}</small></span>{t.closed&&<Icon name="lock"/>}{t.unread_count>0&&<span className="badge">{t.unread_count}</span>}</button>);
 if(info.layout!=='list')return <nav className="forum-tabs telegram-forum-tabs" aria-label="Темы группы"><button aria-current={all?'page':undefined} onClick={onAll}>Все</button>{buttons}<button className="forum-browse" onClick={onManage} aria-label="Управление темами"><Icon name="more"/></button></nav>;
 if(!open||!target)return null;
 return createPortal(<section className="forum-sidebar" aria-label={'Темы группы '+group.name}><header><button className="icon-button" aria-label="Вернуться к чатам" onClick={onBack}><Icon name="back"/></button><span><strong>{group.name}</strong><small>{info.member_count} участников</small></span><details className="app-menu"><summary aria-label="Действия группы"><Icon name="more"/></summary><div className="app-menu-content">{info.can_create&&<button onClick={e=>{e.currentTarget.closest('details').open=false;onCreate();}}>Создать тему</button>}<button onClick={e=>{e.currentTarget.closest('details').open=false;onSettings();}}>Управление группой</button><button onClick={e=>{e.currentTarget.closest('details').open=false;onAll();}}>Единый чат</button><button onClick={e=>{e.currentTarget.closest('details').open=false;onManage();}}>Настройки тем</button></div></details></header><input aria-label="Поиск темы" placeholder="Поиск темы" value={query} onChange={e=>setQuery(e.target.value)}/><nav aria-label="Темы группы"><button className={'forum-navigation-topic '+(all?'selected':'')} aria-current={all?'page':undefined} onClick={onAll}><span className="forum-topic-icon">💬</span><span className="forum-topic-copy"><strong>Все сообщения</strong><small>Общая история группы</small></span></button>{buttons}</nav>{info.can_create&&<button className="forum-create-topic" onClick={onCreate}>Создать тему</button>}</section>,target);
}
