import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
test('profiles: authorization, limits, realtime notification, immutable identity and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-profile-'));const database=join(dir,'db');let app,base;
 async function start(){app=createApp({database});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;}
 async function call(path,token,data){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};}
 await start();const controller=new AbortController();
 try{
  const a=(await call('/register','',{username:'alice',name:'Алиса',password:'test-password-long'})).data;
  const b=(await call('/register','',{username:'boris',name:'Борис',password:'test-password-long'})).data;
  assert.equal(a.user.bio,'');await call('/chats',a.token,{user_id:b.user.id});
  assert.equal((await call('/users/'+a.user.id,'')).status,401);
  assert.equal((await call('/profile','',{name:'Взлом',bio:''})).status,401);
  assert.equal((await call('/users/99999',a.token)).status,404);
  for(const data of [{name:' ',bio:''},{name:'a'.repeat(65),bio:''},{name:'A',bio:'b'.repeat(281)},{name:[],bio:''},{name:'A\nB',bio:''}])assert.equal((await call('/profile',a.token,data)).status,400);
  const res=await fetch(base+'/events',{headers:{Authorization:'Bearer '+b.token},signal:controller.signal});const reader=res.body.getReader();await reader.read();
  const changed=await call('/profile',a.token,{name:' Алиса Новая ',bio:'Строю Волну\n<script>not executable</script>',user_id:b.user.id,username:'hacked',hash:'hacked'});
  assert.equal(changed.status,200);assert.equal(changed.data.name,'Алиса Новая');assert.equal(changed.data.username,'alice');assert.equal(changed.data.id,a.user.id);assert.equal('hash' in changed.data,false);assert.equal('salt' in changed.data,false);
  const next=await Promise.race([reader.read(),new Promise((_,reject)=>{setTimeout(()=>reject(Error('missing profile event')),2000).unref();})]);assert.match(new TextDecoder().decode(next.value),/"type":"profile"/);controller.abort();
  assert.equal((await call('/me',b.token)).data.name,'Борис');assert.equal((await call('/chats',b.token)).data[0].name,'Алиса Новая');assert.equal((await call('/users/'+a.user.id,b.token)).data.bio,changed.data.bio);
  await app.close();await start();assert.equal(app.db.prepare('PRAGMA user_version').get().user_version,7);assert.equal((await call('/me',a.token)).data.bio,changed.data.bio);
  assert.equal((await call('/profile',a.token,{name:'Алиса',bio:''})).data.bio,'');
 }finally{controller.abort();await app.close();rmSync(dir,{recursive:true,force:true});}
});
