/** Forward voice audio to the private, local Whisper container. No paid API key is used. */
export function createTranscriber({endpoint=process.env.WHISPER_URL||'http://transcription:8000/transcribe',fetchImpl=fetch}={}) {
  return async ({bytes,name,mime}) => {
    const form=new FormData();
    form.set('file',new Blob([bytes],{type:mime||'application/octet-stream'}),name||'voice.webm');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try {
      const response=await fetchImpl(endpoint,{method:'POST',body:form,signal:controller.signal});
      if(!response.ok) {
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
      if(error.cause?.code==='ECONNREFUSED'||error.cause?.code==='EAI_AGAIN')throw Object.assign(new Error('Локальный сервис распознавания недоступен'),{status:503});
      throw error;
    } finally {clearTimeout(timer);}
  };
}
