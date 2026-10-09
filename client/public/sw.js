/* Cache only the public offline page: never API responses, messages or files. */
const CACHE='volna-offline-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('volna-offline-')&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||event.request.mode!=='navigate')return;
 event.respondWith(fetch(event.request).catch(async()=>await caches.match('/offline.html')||Response.error()));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 const chat=Number.isSafeInteger(payload.chat_id)&&payload.chat_id>0?payload.chat_id:null;
 const expiredCall=payload.kind==='call'&&payload.expires<Date.now();
 await self.registration.showNotification(String(payload.title||'Волна').slice(0,100),{
  body:expiredCall?'Пропущенный аудиозвонок':String(payload.body||'Новое сообщение').slice(0,200),
  icon:'/icons/icon-192.png',badge:'/icons/badge-96.png',tag:String(payload.tag||'volna').slice(0,80),
  data:{chat_id:chat},renotify:true,vibrate:[160,80,160]
 });
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();const id=event.notification.data?.chat_id;
 const path=Number.isSafeInteger(id)&&id>0?'/app?chat='+id:'/app';
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows)if(new URL(client.url).origin===self.location.origin&&new URL(client.url).pathname.startsWith('/app')){try{await client.focus();client.postMessage({type:'volna-open-chat',chat_id:id});return;}catch{}}
  await self.clients.openWindow(path);
 })());
});
