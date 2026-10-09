// Test-only adapter: old messaging fixtures obtain real SMS sessions. No legacy server routes are enabled.
import {createApp as realCreateApp} from '../server/index.mjs';
const apps=new Set();let next=1000000;
export function createApp(options={}) {
 const sent=new Map();let now=Date.now();
 const app=realCreateApp({...options,phoneAuthOptions:{smsReady:true,sender:async row=>{sent.set(row.id,row.code);return {id:'test'};},clock:()=>now}});
 app.testPhones=new Map();app.testSent=sent;app.testAdvance=()=>{now+=3600001;};apps.add(app);
 const close=app.close;app.close=async()=>{apps.delete(app);await close();};return app;
}
export async function fixtureFetch(url,init={}) {
 const u=new URL(url);if(!['/api/register','/api/login'].includes(u.pathname))return globalThis.fetch(url,init);
 const app=[...apps].find(x=>x.server.address()?.port===Number(u.port));if(!app)throw Error('Unknown SMS fixture server');
 const input=JSON.parse(init.body||'{}'),name=input.username;
 const existing=app.db.prepare('SELECT phone FROM users WHERE username=?').get(name);
 if(u.pathname.endsWith('register')&&existing)return new Response(JSON.stringify({error:'Duplicate test fixture'}),{status:409});
 const phone=existing?.phone||'+7900'+String(next++).padStart(7,'0');app.testAdvance();
 const headers={'Content-Type':'application/json','User-Agent':'VolnaAndroid/test'};
 const send=await globalThis.fetch(u.origin+'/api/auth/sms/request',{method:'POST',headers,body:JSON.stringify({phone})});const request=await send.json();
 if(!send.ok)throw Error('SMS fixture request: '+JSON.stringify(request));
 const verify=await globalThis.fetch(u.origin+'/api/auth/sms/verify',{method:'POST',headers,body:JSON.stringify({sms_session_id:request.sms_session_id,code:app.testSent.get(request.sms_session_id)})});const session=await verify.json();
 if(!verify.ok)throw Error('SMS fixture verify: '+JSON.stringify(session));
 if(!existing)app.db.prepare('UPDATE users SET username=?,name=? WHERE id=?').run(name,input.name||name,session.user.id);
 session.user=await (await globalThis.fetch(u.origin+'/api/me',{headers:{Authorization:'Bearer '+session.token}})).json();
 return new Response(JSON.stringify(session),{status:200,headers:{'Content-Type':'application/json'}});
}
