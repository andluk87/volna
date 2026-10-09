import {DEMO_TOKEN,demoRequest,demoEvents,demoBlob,demoUpload} from './demo-api.mjs';
import {sessionFetch} from './session.mjs';
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
export async function request(path, token, data, signal, method) {
  if(token===DEMO_TOKEN)return demoRequest(path,data,method||(data===undefined?'GET':'POST'),signal);
  const res = await sessionFetch(API + '/api' + path, { method: method || (data === undefined ? 'GET' : 'POST'), headers: { ...(token ? {Authorization:'Bearer '+token}:{}), ...(data === undefined ? {} : {'Content-Type':'application/json'}) }, ...(data === undefined ? {} : {body:JSON.stringify(data)}), signal });
  const value = await res.json(); if (!res.ok) throw Object.assign(new Error(value.error || 'Ошибка запроса'), {status:res.status,suggestions:value.suggestions}); return value;
}
export async function events(token, signal, onEvent, onStatus, onUnauthorized) {
  if(token===DEMO_TOKEN)return demoEvents(signal,onEvent,onStatus);
  while (!signal.aborted) {
    try {
      const res = await sessionFetch(API+'/api/events',{headers:{Authorization:'Bearer '+token},signal});
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw Error('Соединение недоступно');
      onStatus(true); const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      if(token===DEMO_TOKEN)return demoEvents(signal,onEvent,onStatus);
  while (!signal.aborted) {
        const {done,value} = await reader.read(); if (done) break; buffer += decoder.decode(value,{stream:true});
        let end; while ((end=buffer.indexOf('\n\n')) !== -1) { const frame=buffer.slice(0,end); buffer=buffer.slice(end+2); if(frame.startsWith('data: ')) onEvent(JSON.parse(frame.slice(6))); }
      }
    } catch(e) { if (signal.aborted) return; }
    onStatus(false);
    await new Promise(resolve => { const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,2000);signal.addEventListener('abort',done,{once:true}); });
  }
}
export function messageId(){
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function uploadFile(file,token,signal){
  if(token===DEMO_TOKEN)return demoUpload(file);
  if(file.size>20*1024*1024)throw Error('Максимальный размер файла — 20 МБ');
  const res=await sessionFetch(API+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,signal});
  const value=await res.json();if(!res.ok)throw Object.assign(new Error(value.error||'Ошибка загрузки'),{status:res.status});return value;
}
export async function fileBlob(id,token,signal){
  if(token===DEMO_TOKEN)return demoBlob(id,signal);
  const res=await sessionFetch(API+'/api/files/'+id,{headers:{Authorization:'Bearer '+token},signal});
  if(!res.ok){const value=await res.json();throw Object.assign(new Error(value.error||'Файл недоступен'),{status:res.status});}return res.blob();
}
