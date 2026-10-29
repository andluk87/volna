// Only commands whose server handler tolerates replay with the exact same payload.
export async function retryCallMutation(request,path,token,data){
 try{return await request(path,token,data);}catch(error){
  if(data===undefined||!/^\/calls\/(?:start|[a-f0-9]{32}\/(?:offer|accept|answer|end|media-state|ice-restart))$/.test(path)||error.name==='AbortError'||error.status&&error.status<500)throw error;
  return request(path,token,data);
 }
}
