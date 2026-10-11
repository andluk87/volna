import {useEffect} from 'react';
const selector='details.app-menu[open],details.chat-actions[open],details.message-actions[open],details.attach-menu[open]';
export default function usePopupMenus(){
 useEffect(()=>{
  const outside=e=>{for(const menu of document.querySelectorAll(selector))if(!menu.contains(e.target))menu.open=false;};
  const escape=e=>{if(e.key!=='Escape')return;const menus=[...document.querySelectorAll(selector)];if(!menus.length)return;e.preventDefault();e.stopPropagation();const last=menus.at(-1);for(const menu of menus)menu.open=false;last.querySelector('summary')?.focus();};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('contextmenu',outside,true);document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('contextmenu',outside,true);document.removeEventListener('keydown',escape,true);};
 },[]);
}
