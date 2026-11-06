export async function callNetworkRetry(action,{valid=()=>true,waiting=()=>{},now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeout=180000}={}){
 const start=now();for(;;){if(!valid())throw Object.assign(Error('Call cancelled'),{name:'AbortError'});try{return await action();}catch(error){if(error.name==='AbortError'||error.status&&![502,503,504].includes(error.status)||now()-start>=timeout)throw error;waiting();await sleep(1000);}}
}
