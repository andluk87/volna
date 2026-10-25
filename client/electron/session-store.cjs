const fs=require('node:fs');
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const account=value=>Number.isSafeInteger(value?.user?.id)&&value.user.id>0&&token(value.token)&&token(value.refresh_token)&&Number.isSafeInteger(value.expires);
const valid=value=>value&&Array.isArray(value.accounts)&&value.accounts.length<=5&&value.accounts.every(account)&&new Set(value.accounts.map(a=>a.user.id)).size===value.accounts.length&&(value.selected===null||value.accounts.some(a=>a.user.id===value.selected))&&JSON.stringify(value).length<=100000;
function createSessionStore({file,legacyFile,secure}){
 const read=path=>{try{return fs.readFileSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const available=()=>{if(!secure.isEncryptionAvailable())throw Error('Защищённое хранилище временно недоступно. Повторите подключение.');};
 const load=()=>{const bytes=read(file);if(!bytes)return null;available();try{const value=JSON.parse(secure.decryptString(bytes));if(!valid(value))throw Error('Invalid account data');return value;}catch{throw Error('Не удалось прочитать сохранённый сеанс. Повторите подключение.');}};
 const save=(value,{secondary=false,fresh=false}={})=>{
  if(!valid(value)||value.removed!==undefined&&(!Array.isArray(value.removed)||value.removed.length>5||value.removed.some(id=>!Number.isSafeInteger(id)||id<1)))throw Error('Invalid accounts');
  available();const stored=load(),removed=new Set(value.removed||[]),records=new Map((stored?.accounts||[]).filter(a=>!removed.has(a.user.id)).map(a=>[a.user.id,a]));
  for(const incoming of value.accounts){if(removed.has(incoming.user.id)||secondary&&!records.has(incoming.user.id))continue;const old=records.get(incoming.user.id);if(fresh||!old||incoming.expires>old.expires)records.set(incoming.user.id,incoming);}
  if(records.size>5)throw Error('Можно добавить не более 5 аккаунтов');
  const selected=secondary?stored?.selected??null:value.selected;
  const result={selected:records.has(selected)?selected:null,accounts:[...records.values()]};
  if(!valid(result))throw Error('Invalid merged accounts');
  const temp=file+'.tmp';fs.writeFileSync(temp,secure.encryptString(JSON.stringify(result)),{mode:0o600});fs.renameSync(temp,file);fs.rmSync(legacyFile,{force:true});return result;
 };
 const loadLegacy=()=>{const bytes=read(legacyFile);if(!bytes)return null;available();try{const value=secure.decryptString(bytes);if(!token(value))throw Error('Invalid legacy session');return value;}catch{throw Error('Не удалось прочитать сохранённый сеанс. Повторите подключение.');}};
 return {load,save,loadLegacy};
}
function createSessionRefresh({store,request,now=Date.now}){
 const running=new Map(),unsaved=new Map();
 async function refresh(value){
  if(!Number.isSafeInteger(value?.accountId)||value.accountId<1||!token(value.token))throw Error('Invalid refresh request');
  const id=value.accountId;if(running.has(id))return running.get(id);
  const task=(async()=>{
   const saved=store.load()?.accounts.find(a=>a.user.id===id);if(!saved){unsaved.delete(id);return {status:401};}
   let next=unsaved.get(id);
   if(!next){
    if(saved.token!==value.token&&saved.expires>now())return {status:200,session:saved};
    const result=await request(saved.refresh_token,id);
    if(result.status!==200)return {status:result.status};
    if(!account(result.session)||result.session.user.id!==id)throw Error('Invalid refreshed account');
    next=result.session;unsaved.set(id,next);
   }
   if(!store.load()?.accounts.some(a=>a.user.id===id)){unsaved.delete(id);return {status:401};}
   // Keep a rotated token in memory if secure storage briefly fails; retry the
   // write rather than submitting the obsolete refresh token a second time.
   store.save({selected:null,accounts:[next]},{secondary:true,fresh:true});unsaved.delete(id);
   return {status:200,session:next};
  })();running.set(id,task);
  try{return await task;}finally{running.delete(id);}
 }
 return {refresh,forget:id=>unsaved.delete(id),pending:()=>running.size>0||unsaved.size>0};
}
module.exports={createSessionStore,createSessionRefresh};
