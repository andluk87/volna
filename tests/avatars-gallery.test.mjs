import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('profile images are owned, validated and durable; gallery is private, paginated and excludes deleted messages',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-gallery-')),database=join(dir,'db'),uploads=join(dir,'uploads');let app,base;
 async function start(){app=createApp({database,uploads});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}/api`;}
 async function call(path,token,data){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};}
 const png=readFileSync(new URL('../client/public/icons/icon-192.png',import.meta.url));
 async function upload(token,mime='image/png',bytes=png){const response=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':mime,'X-File-Name':'profile.png'},body:bytes});assert.equal(response.status,201);return response.json();}
 async function file(id,token){const response=await fetch(base+'/files/'+id,{headers:{Authorization:'Bearer '+token}});const bytes=Buffer.from(await response.arrayBuffer());return {status:response.status,bytes};}
 await start();
 try{
  const accounts=[];for(const username of ['alice','boris','carol'])accounts.push((await call('/register','',{username,name:username,password:'test-password-long'})).data);
  const [a,b,c]=accounts,chat=(await call('/chats',a.token,{user_id:b.user.id})).data.id;
  const profile={name:'Alice',bio:'Description'},avatar=await upload(a.token),foreign=await upload(b.token);
  assert.equal((await file(avatar.id,c.token)).status,404);
  assert.equal((await call('/profile',a.token,{...profile,avatar_id:foreign.id})).status,400);
  assert.equal((await call('/profile',a.token,{...profile,avatar_id:avatar.id,avatar_hidden:'true'})).status,400);
  for(const [mime,bytes] of [['text/plain',Buffer.from('not an image')],['image/png',Buffer.from('<script>invalid image</script>')],['image/jpeg',Buffer.from('invalid jpeg')],['image/webp',Buffer.from('invalid webp')],['image/png',Buffer.alloc(5*1024*1024+1)]]){
   const bad=await upload(a.token,mime,bytes);assert.equal((await call('/profile',a.token,{...profile,avatar_id:bad.id})).status,400);
   assert.equal((await call('/uploads/'+bad.id+'/discard',a.token,{})).status,200);
  }
  let updated=await call('/profile',a.token,{...profile,avatar_id:avatar.id});assert.equal(updated.status,200);assert.equal(updated.data.avatar_url,'/api/files/'+avatar.id);
  assert.equal((await file(avatar.id,'')).status,401);assert.deepEqual((await file(avatar.id,c.token)).bytes,png);
  assert.equal((await call('/uploads/'+avatar.id+'/discard',a.token,{})).status,409);
  const sent=(await call('/chats/'+chat+'/messages',a.token,{text:'Photo',attachment_id:avatar.id,client_id:randomUUID()})).data;
  assert.equal((await call('/chats/'+chat+'/media',b.token)).data.length,1);
  await call('/messages/'+sent.id+'/delete',a.token,{});assert.equal(existsSync(join(uploads,avatar.id)),true);assert.equal((await file(avatar.id,c.token)).status,200);assert.deepEqual((await call('/chats/'+chat+'/media',b.token)).data,[]);
  assert.equal((await call('/chats/'+chat+'/media',c.token)).status,404);
  assert.equal((await call('/chats/'+chat+'/media?before=bad',a.token)).status,400);
  const ordinary=await upload(a.token,'text/plain',Buffer.from('private file'));
  const original=(await call('/chats/'+chat+'/messages',a.token,{text:'File',attachment_id:ordinary.id,client_id:randomUUID()})).data;
  for(let i=0;i<51;i++)assert.equal((await call('/messages/'+original.id+'/forward',a.token,{chat_id:chat,client_id:randomUUID()})).status,201);
  const first=(await call('/chats/'+chat+'/media',b.token)).data;assert.equal(first.length,50);assert.ok(first.every(m=>m.attachment.id===ordinary.id));assert.ok(first.every((m,i)=>i===0||m.id<first[i-1].id));
  const second=(await call('/chats/'+chat+'/media?before='+first.at(-1).id,b.token)).data;assert.equal(second.length,2);assert.equal(new Set([...first,...second].map(m=>m.id)).size,52);
  assert.equal((await file(ordinary.id,c.token)).status,404);
  app.db.prepare('UPDATE attachments SET created_at=0 WHERE id=?').run(avatar.id);
  await app.close();await start();assert.equal((await call('/me',a.token)).data.avatar_url,'/api/files/'+avatar.id);assert.equal((await file(avatar.id,c.token)).status,200);
  updated=await call('/profile',a.token,{...profile,avatar_id:null,avatar_hidden:true});assert.equal(updated.data.avatar_url,null);assert.equal((await file(avatar.id,c.token)).status,404);
  assert.equal((await call('/chats',b.token)).data[0].avatar_url,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
