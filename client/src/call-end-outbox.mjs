const ttl=86400000;
/** Only call identifiers and intent, never credentials. Each entry has its own storage key. */
export class CallEndOutbox{
 constructor({scope,storage=null,now=Date.now}={}){this.prefix='volna.call.ends.'+encodeURIComponent(scope||'temporary')+'.';this.storage=storage;this.now=now;this.memory=new Map();this.running=null;}
 key(value){return this.prefix+value.call_id+'.'+value.device;}
 write(value){this.memory.set(this.key(value),value);try{this.storage?.setItem(this.key(value),JSON.stringify(value));}catch{}}
 remove(value){this.memory.delete(this.key(value));try{this.storage?.removeItem(this.key(value));}catch{}}
 entries(){
  const values=new Map(this.memory);try{for(let i=0;i<(this.storage?.length||0);i++){const key=this.storage.key(i);if(key?.startsWith(this.prefix)){try{const value=JSON.parse(this.storage.getItem(key));if(/^[a-f0-9]{32}$/.test(value.call_id)&&/^[a-f0-9]{32}$/.test(value.device)&&Number.isFinite(value.created))values.set(key,value);}catch{}}}}catch{}
  const live=[];for(const value of values.values()){if(this.now()-value.created>ttl||value.created>this.now()+60000)this.remove(value);else live.push(value);}return live.sort((a,b)=>a.created-b.created);
 }
 has(id){return this.entries().some(value=>value.call_id===id);}
 add(value){if(!/^[a-f0-9]{32}$/.test(value.call_id)||!/^[a-f0-9]{32}$/.test(value.device))return;const old=this.entries().find(x=>this.key(x)===this.key(value));if(old)return;this.write({call_id:value.call_id,device:value.device,end_reason:value.end_reason,created:this.now(),next:0,attempts:0});for(const stale of this.entries().slice(0,-16))this.remove(stale);}
 flush(send,{force=false}={}){if(this.running)return this.running;this.running=this.run(send,force).finally(()=>{this.running=null;});return this.running;}
 async run(send,force){for(const value of this.entries()){
  if(value.rate_until>this.now()||!force&&value.next>this.now())continue;
  try{await send(value);this.remove(value);}catch(error){
   if([400,403,404,409,410].includes(error.status)){this.remove(value);continue;}
   value.attempts++;if(error.status===429)value.rate_until=this.now()+(error.retryAfterMs||60000);value.next=this.now()+(error.status===429?error.retryAfterMs||60000:Math.min(60000,1000*2**Math.min(value.attempts,6)));this.write(value);
  }
 }}
}
