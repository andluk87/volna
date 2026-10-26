import React,{useEffect} from 'react';
export default function DesktopChrome(){
 const bridge=window.volnaDesktop,overlay=bridge?.windowFrame==='overlay';
 useEffect(()=>{
  if(!overlay)return;
  const root=document.documentElement;
  const sync=()=>bridge.setWindowTheme?.(root.dataset.theme==='light'?'light':'dark')?.catch(()=>{});
  sync();const observer=new MutationObserver(sync);observer.observe(root,{attributes:true,attributeFilter:['data-theme']});
  return()=>observer.disconnect();
 },[bridge,overlay]);
 return overlay?<div className="desktop-titlebar" aria-hidden="true"/>:null;
}
