const list=document.querySelector('main');
window.vlnToast.subscribe(entries=>{
 const old=new Map([...list.children].map(node=>[Number(node.dataset.id),{node,y:node.getBoundingClientRect().top}]));
 for(const {node} of old.values())if(!entries.some(e=>e.id===Number(node.dataset.id)))node.remove();
 for(const entry of entries){let node=old.get(entry.id)?.node;if(!node){
  node=document.createElement('article');node.className='toast';node.tabIndex=0;node.setAttribute('role','button');node.dataset.id=entry.id;
  const header=document.createElement('header'),icon=document.createElement('img'),title=document.createElement('strong'),body=document.createElement('p'),close=document.createElement('button');
  icon.src='../dist/icons/icon-192.png';icon.alt='';title.textContent=entry.title;body.textContent=entry.body;close.textContent='×';close.setAttribute('aria-label','Закрыть уведомление');
  close.onclick=e=>{e.stopPropagation();window.vlnToast.close(entry.id);};node.onclick=()=>window.vlnToast.open(entry.id);node.onkeydown=e=>{if(e.target===node&&['Enter',' '].includes(e.key)){e.preventDefault();window.vlnToast.open(entry.id);}};
  header.append(icon,title);node.append(header,body,close);list.append(node);
 }
 }
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const {node,y} of old.values()){if(!node.isConnected)continue;const delta=y-node.getBoundingClientRect().top;if(delta)node.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:220,easing:'ease-out'});}
});

let sound;window.vlnToast.onSound?.(({volume})=>{sound?.pause();sound=new Audio('../dist/appearance-sample.wav');sound.volume=volume/100;sound.play().catch(()=>{});});
