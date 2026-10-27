const fs=require('node:fs'),path=require('node:path');
const EVENTS=new Set(['app-start','log-open','refresh-start','refresh-reuse','refresh-ok','refresh-rejected','refresh-error','refresh-write-pending','renderer-401','renderer-reuse','renderer-removed','renderer-retry-limit','renderer-logout']);
/** Explicit fields only: never serialize tokens, refresh secrets, URLs or exception messages. */
function createSessionLog({directory,version,maxBytes=256*1024}){
 const file=path.join(directory,'session.log'),previous=path.join(directory,'session.previous.log');
 function write(event,details={}){
  if(!EVENTS.has(event))return false;
  const entry={utc:new Date().toISOString(),version:String(version).slice(0,32),event};
  if(Number.isSafeInteger(details.accountId)&&details.accountId>0)entry.accountId=details.accountId;
  if(Number.isInteger(details.status)&&details.status>=100&&details.status<=599)entry.status=details.status;
  if(Number.isInteger(details.elapsedMs)&&details.elapsedMs>=0)entry.elapsedMs=Math.min(details.elapsedMs,3600000);
  try{fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>=maxBytes){fs.rmSync(previous,{force:true});fs.renameSync(file,previous);}fs.appendFileSync(file,JSON.stringify(entry)+'\n',{mode:0o600});return true;}catch{return false;}
 }
 return {file,write};
}
module.exports={createSessionLog};
