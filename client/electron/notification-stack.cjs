function createNotificationStack({publish,open,now=Date.now,timers=globalThis,ttl=6000,max=5}) {
 let next=0,entries=[];const handles=new Map();
 function remove(id){const found=entries.some(e=>e.id===id);entries=entries.filter(e=>e.id!==id);timers.clearTimeout(handles.get(id));handles.delete(id);if(found)publish(entries);}
 function push(value){const entry={id:++next,title:String(value.title||'VLN').slice(0,80),body:String(value.body||'Новое сообщение').slice(0,500),chatId:value.chatId,accountId:value.accountId,created:now()};
  while(entries.length>=max){const oldest=entries.shift();timers.clearTimeout(handles.get(oldest.id));handles.delete(oldest.id);}
  entries.push(entry);handles.set(entry.id,timers.setTimeout(()=>remove(entry.id),ttl));publish(entries);return entry.id;
 }
 function activate(id){const entry=entries.find(e=>e.id===id);if(!entry)return false;remove(id);open(entry);return true;}
 function clear(){for(const timer of handles.values())timers.clearTimeout(timer);handles.clear();entries=[];publish(entries);}
 function configure(limit){max=Math.max(1,Math.min(5,Number(limit)||5));while(entries.length>max)remove(entries[0].id);}
 return {push,remove,activate,clear,configure,snapshot:()=>entries.slice()};
}
module.exports={createNotificationStack};
