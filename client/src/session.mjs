import {API} from './api.js';
let current=null,restoring=null;
const sessionChannel=typeof window!=='undefined'&&typeof window.BroadcastChannel==='function'?new window.BroadcastChannel('volna.sessions'):null;
const sessions=new Map(),aliases=new Map(),refreshing=new Map(),listeners=new Set(),accountListeners=new Set();
export const onSessionChange=callback=>{listeners.add(callback);return()=>listeners.delete(callback);};
export const onAccountsChange=callback=>{accountListeners.add(callback);return()=>accountListeners.delete(callback);};
export const accountSessions=()=>[...sessions.values()];
const diagnostic=(event,accountId)=>{try{window.volnaDesktop?.sessionDiagnostic?.({event,accountId})?.catch(()=>{});}catch{}};
const accountsChanged=()=>{for(const notify of accountListeners)notify(accountSessions());};
const legacyCleanup=()=>{sessionStorage.removeItem('volna.token');localStorage.removeItem('volna.token');};
async function persist(removed=[]){if(window.volnaDesktop?.saveAccounts)await window.volnaDesktop.saveAccounts({selected:sessions.has(current?.user?.id)?current.user.id:null,accounts:accountSessions(),removed});else if(current?.refresh_token&&window.volnaDesktop)await window.volnaDesktop.saveSession(current.refresh_token);}
export async function saveSession(result,select=true,announce=true){
 if(!result?.token||!result.user?.id)return;legacyCleanup();const id=result.user.id;
 if(!sessions.has(id)&&sessions.size>=5)throw Error('Можно добавить не более 5 аккаунтов');
 sessions.set(id,result);aliases.set(result.token,id);
 if(select||current?.user?.id===id){current=result;for(const notify of listeners)notify(result);}
 await persist();accountsChanged();if(announce)sessionChannel?.postMessage({type:'session',result});
}
export async function selectAccount(id){const result=sessions.get(id);if(!result)throw Error('Аккаунт недоступен');const value=window.volnaDesktop&&result.expires>Date.now()?result:await refreshAccount(id,true,true);if(!value)throw Error('Войдите в этот аккаунт заново');await saveSession(value);return value;}
export function clearStoredSession(){
 const id=current?.user?.id;diagnostic('renderer-logout',id);current=null;legacyCleanup();if(id){sessions.delete(id);sessionChannel?.postMessage({type:'removed',id});for(const [token,owner] of aliases)if(owner===id)aliases.delete(token);}
 if(window.volnaDesktop?.saveAccounts)persist(id?[id]:[]).catch(()=>{});else window.volnaDesktop?.clearSession().catch(()=>{});
 fetch(API+'/api/auth/clear',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{account_id:id}:{})}).catch(()=>{});accountsChanged();
}
export async function refreshAccount(id,throwNetwork=false,select=false,failedToken=null){
 let task=refreshing.get(id);
 if(!task){task=(async()=>{
  const existing=sessions.get(id),refresh=existing?.refresh_token;
  // A delayed 401 belongs to the credential that was sent, not whichever token
  // happened to become current while that request was in flight.
  if(failedToken&&existing?.token&&existing.token!==failedToken)return existing;
  const native=window.volnaDesktop?.refreshSession&&existing?.token?await window.volnaDesktop.refreshSession({accountId:id,token:failedToken||existing.token}):null;
  const response=native?{status:native.status,ok:native.status===200,json:async()=>native.session}:await fetch(API+'/api/auth/refresh',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({... (refresh?{refresh_token:refresh}:{}),...(id?{account_id:id}:{}),select:select||current?.user?.id===id||!current})});
  if(response.status===401){const latest=sessions.get(id);if(latest?.token&&latest.token!==existing?.token)return latest;if(id){diagnostic('renderer-removed',id);sessions.delete(id);await persist([id]);accountsChanged();}return null;}if(!response.ok)throw Error('Не удалось обновить сеанс. Повторите подключение.');
  const result=await response.json(),latest=sessions.get(id);
  if(id&&existing&&!latest)return null; // Explicit logout must win over a late refresh.
  if(latest&&latest!==existing&&latest.expires>=result.expires)return latest;
  await saveSession(result,!current&&!id);return sessions.get(result.user.id)||result;
 })();refreshing.set(id,task);}
 try{return await task;}catch(error){if(throwNetwork)throw error;return null;}finally{if(refreshing.get(id)===task)refreshing.delete(id);}
}
export async function restoreSession(throwNetwork=true){
 legacyCleanup();if(current)return refreshAccount(current.user.id,throwNetwork);if(restoring)return restoring;
 restoring=(async()=>{try{
  let selected=null;
  if(window.volnaDesktop?.loadAccounts){const stored=await window.volnaDesktop.loadAccounts();if(stored?.accounts?.length){for(const value of stored.accounts){sessions.set(value.user.id,value);aliases.set(value.token,value.user.id);}selected=stored.selected;}}
  if(!sessions.size&&window.volnaDesktop){const refresh=await window.volnaDesktop.loadSession();if(!refresh)return null;const response=await fetch(API+'/api/auth/refresh',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh})});if(!response.ok)return null;const result=await response.json();await saveSession(result);return result;}
  if(!window.volnaDesktop){const response=await fetch(API+'/api/auth/accounts',{credentials:'include'});if(response.ok){const stored=await response.json();selected=stored.selected;for(const user of stored.accounts||[])sessions.set(user.id,{user,token:'',expires:0});}}
  if(sessions.size){const ids=[...sessions.keys()];const requested=Number(new URLSearchParams(location.search).get('account'));selected=ids.includes(requested)?requested:ids.includes(selected)?selected:ids[0];current=sessions.get(selected);for(const id of ids){const value=sessions.get(id);if(!value.token||value.expires<=Date.now())await refreshAccount(id,throwNetwork);}if(!sessions.has(selected))selected=[...sessions.keys()][0];const result=sessions.get(selected);if(result?.token){await saveSession(result);return result;}return null;}
  const result=await refreshAccount(null,throwNetwork);return result;
 }catch(error){if(throwNetwork)throw error;return null;}finally{restoring=null;}})();return restoring;
}
export async function sessionFetch(url,options={},transport=fetch){
 const headers=new Headers(options.headers),provided=headers.get('Authorization')?.replace(/^Bearer /,''),id=provided?aliases.get(provided):null;
 const discard=response=>response.body?.cancel().catch(()=>{});
 for(let attempt=0;attempt<4;attempt++){
  options.signal?.throwIfAborted();
  const sentToken=id?sessions.get(id)?.token||provided:provided;
  if(sentToken)headers.set('Authorization','Bearer '+sentToken);
  const response=await transport(url,{...options,credentials:'include',headers});
  if(response.status!==401||!id)return response;
  options.signal?.throwIfAborted();
  diagnostic('renderer-401',id);
  const latest=sessions.get(id);
  if(!latest)return response;
  if(latest.token!==sentToken)diagnostic('renderer-reuse',id);
  if(latest.token===sentToken){const result=await refreshAccount(id,true,false,sentToken);options.signal?.throwIfAborted();if(!result)return response;}
  // Reuse the latest credential for a stale response. Never rotate a valid
  // replacement just because an earlier request completed out of order.
  await discard(response);
 }
 // Repeated rotation is retryable; it does not prove the device was revoked.
 diagnostic('renderer-retry-limit',id);
 throw Object.assign(Error('Сеанс обновляется. Повторите запрос через несколько секунд.'),{status:503,code:'SESSION_RETRY_REQUIRED'});
}

sessionChannel?.addEventListener('message',event=>{if(event.data?.type==='removed'&&Number.isSafeInteger(event.data.id)){const id=event.data.id;sessions.delete(id);for(const [token,owner] of aliases)if(owner===id)aliases.delete(token);if(current?.user?.id===id){current=null;window.dispatchEvent(new CustomEvent('volna-account-removed',{detail:id}));}accountsChanged();return;}const result=event.data?.result;if(event.data?.type!=='session'||!Number.isSafeInteger(result?.user?.id)||!/^[A-Za-z0-9_-]{43}$/.test(result?.token)||!Number.isSafeInteger(result.expires))return;const existing=sessions.get(result.user.id);if(existing?.expires>result.expires)return;saveSession(result,false,false).catch(()=>{});});
