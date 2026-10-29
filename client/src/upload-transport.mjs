// Response-compatible transport: sessionFetch retains account-specific token refresh.
export function uploadTransport(onProgress){return (url,options={})=>new Promise((resolve,reject)=>{
 const xhr=new XMLHttpRequest(),signal=options.signal;
 const abort=()=>xhr.abort();const clean=()=>signal?.removeEventListener('abort',abort);
 if(signal?.aborted){reject(new DOMException('Отменено','AbortError'));return;}
 xhr.open(options.method||'POST',url);xhr.withCredentials=options.credentials==='include';
 for(const [name,value] of new Headers(options.headers))xhr.setRequestHeader(name,value);
 xhr.upload.onprogress=e=>onProgress(e.loaded,e.lengthComputable?e.total:options.body?.size||0);
 xhr.onload=()=>{clean();if(!xhr.status){reject(new TypeError('Не удалось загрузить файл.'));return;}try{resolve(new Response(xhr.responseText,{status:xhr.status,headers:{'Content-Type':xhr.getResponseHeader('Content-Type')||'application/json'}}));}catch(error){reject(error);}};
 xhr.onerror=()=>{clean();reject(new TypeError('Не удалось загрузить файл. Проверьте сеть.'));};
 xhr.onabort=()=>{clean();reject(new DOMException('Отменено','AbortError'));};
 signal?.addEventListener('abort',abort,{once:true});xhr.send(options.body);
});}
export function uploadSize(bytes){return bytes>=1048576?(bytes/1048576).toFixed(1)+' МБ':bytes>=1024?(bytes/1024).toFixed(1)+' КБ':Math.max(0,bytes)+' Б';}
