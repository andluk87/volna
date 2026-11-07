export async function callNetworkRetry(action,{valid=()=>true,waiting=()=>{},now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeout=180000}={}){
 const deadline=now()+timeout;let last;
 for(;;){
  if(!valid())throw Object.assign(Error('Call cancelled'),{name:'AbortError'});
  if(last&&now()>=deadline)throw last;
  try{return await action();}catch(error){
   if(error.name==='AbortError'||error.status&&![429,502,503,504].includes(error.status)||now()>=deadline)throw error;
   last=error;waiting();await sleep(Math.min(error.status===429?error.retryAfterMs||60000:1000,Math.max(0,deadline-now())));
  }
 }
}
