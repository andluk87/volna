/** Forward voice audio to the private, local Whisper container. No paid API key is used. */
export function createTranscriber({endpoint=process.env.WHISPER_URL||'http://transcription:8000/transcribe',fetchImpl=fetch,retryDelay=1000,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  return async ({bytes,name,mime}) => {
    const form=new FormData();
    form.set('file',new Blob([bytes],{type:mime||'application/octet-stream'}),name||'voice.webm');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try {
      let response;
      for(let attempt=0;attempt<2;attempt++){
        try{response=await fetchImpl(endpoint,{method:'POST',body:form,signal:controller.signal});}
        catch(error){
          if(attempt===0&&!controller.signal.aborted&&['ECONNREFUSED','ECONNRESET','EAI_AGAIN','UND_ERR_SOCKET'].includes(error.cause?.code)){await wait(retryDelay);continue;}
          throw error;
        }
        if(attempt===0&&[500,502,504].includes(response.status)){await response.body?.cancel();await wait(retryDelay);continue;}
        break;
      }
      if(!response.ok) {
        const audioErrors={400:'Аудиозапись повреждена или пуста',413:'Аудиозапись слишком большая для распознавания',415:'Этот формат аудио не поддерживается для распознавания',422:'В аудиозаписи не удалось распознать речь'};
        if(audioErrors[response.status])throw Object.assign(new Error(audioErrors[response.status]),{status:response.status});
        if(response.status===429)throw Object.assign(new Error('Сервис распознавания занят. Попробуйте через минуту'),{status:429});
        if(response.status===503) {
          const body=await response.json().catch(()=>null);
          const message=body?.detail?.state==='failed'?'Распознавание временно недоступно. Попробуйте позже':'Локальная модель распознавания ещё загружается';
          throw Object.assign(new Error(message),{status:503});
        }
        throw Object.assign(new Error('Локальное распознавание временно недоступно'),{status:502});
      }
      const result=await response.json();
      const text=typeof result.text==='string'?result.text.trim().slice(0,8000):'';
      if(!text)throw Object.assign(new Error('В аудиозаписи не удалось распознать речь'),{status:422});
      return text;
    } catch(error) {
      if(error.name==='AbortError')throw Object.assign(new Error('Превышено время локального распознавания'),{status:504});
      if(['ECONNREFUSED','ECONNRESET','EAI_AGAIN','UND_ERR_SOCKET'].includes(error.cause?.code))throw Object.assign(new Error('Локальный сервис распознавания недоступен'),{status:503});
      throw error;
    } finally {clearTimeout(timer);}
  };
}
