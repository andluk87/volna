/** Owns speculative network resources until activation. Never creates an audio/video track. */
export class CallPrewarm {
 constructor(dispose){this.dispose=dispose;this.entry=null;}
 matches(id,session){return this.entry?.id===id&&this.entry.session===session;}
 start(id,session,create){
  if(this.matches(id,session))return this.entry.promise;
  this.clear();const entry={id,session,controller:new AbortController(),value:null};this.entry=entry;
  entry.promise=Promise.resolve().then(()=>create(entry.controller.signal)).then(value=>{if(this.entry!==entry){if(value)this.dispose(value);return null;}entry.value=value;return value;}).catch(()=>null);
  return entry.promise;
 }
 get(id,session){return this.matches(id,session)?this.entry.promise:Promise.resolve(null);}
 claim(id,session){if(!this.matches(id,session))return false;this.entry=null;return true;}
 clear(){const old=this.entry;this.entry=null;if(!old)return;old.controller.abort();if(old.value)this.dispose(old.value);old.value=null;}
}
