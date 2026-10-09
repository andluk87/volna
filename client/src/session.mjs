import {API} from './api.js';
let current=null,refreshing=null;const aliases=new Set(),listeners=new Set();
export const onSessionChange=callback=>{listeners.add(callback);return()=>listeners.delete(callback);};
export async function saveSession(result){
 if(!result?.token)return;sessionStorage.removeItem("volna.token");localStorage.removeItem("volna.token"); if(current?.token)aliases.add(current.token);
 current=result;aliases.add(result.token);
 if(window.volnaDesktop&&result.refresh_token)await window.volnaDesktop.saveSession(result.refresh_token);
 for(const notify of listeners)notify(result);
}
export function clearStoredSession(){current=null;aliases.clear();sessionStorage.removeItem('volna.token');localStorage.removeItem('volna.token');window.volnaDesktop?.clearSession().catch(()=>{});fetch(API+'/api/auth/clear',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});}
export async function restoreSession(throwNetwork=false){
 sessionStorage.removeItem("volna.token");localStorage.removeItem("volna.token");
 if(refreshing)return refreshing;
 refreshing=(async()=>{try{
 const refresh=window.volnaDesktop?await window.volnaDesktop.loadSession():null;
 if(window.volnaDesktop&&!refresh)return null;
 const response=await fetch(API+'/api/auth/refresh',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(refresh?{refresh_token:refresh}:{})});
 if(response.status===401)return null;if(!response.ok)throw Error("Не удалось обновить сеанс. Повторите подключение.");const result=await response.json();await saveSession(result);return result;
 }catch(error){if(throwNetwork)throw error;return null;}finally{refreshing=null;}})();return refreshing;
}
export async function sessionFetch(url,options={}){
 const headers=new Headers(options.headers),authorization=headers.get('Authorization'),provided=authorization?.replace(/^Bearer /,'');
 if(provided&&aliases.has(provided)&&current?.token)headers.set('Authorization','Bearer '+current.token);
 const response=await fetch(url,{...options,credentials:'include',headers});
 if(response.status!==401||!provided||!aliases.has(provided))return response;
 const result=await restoreSession(true);if(!result)return response;
 headers.set('Authorization','Bearer '+result.token);return fetch(url,{...options,credentials:'include',headers});
}
