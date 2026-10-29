import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';

test('profile posts: ownership, archive, private files, idempotency and cleanup',async t=>{
 const uploads=mkdtempSync(join(tmpdir(),'volna-posts-')),app=createApp({database:':memory:',uploads});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();rmSync(uploads,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const users=[];for(const username of ['postsalice','postsboris'])users.push((await req('/register','',{username,password:'password-long-enough'})).data);const[a,b]=users;
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WTsAAAAASUVORK5CYII=','base64');
 const upload=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'image/png','X-File-Name':encodeURIComponent('post.png')},body:bytes});assert.equal(upload.status,201);const file=await upload.json();
 const payload={text:'Первая публикация',attachment_id:file.id,client_id:randomUUID()};const published=await req('/posts',a.token,payload);assert.equal(published.status,201);const post=published.data;
 assert.equal((await req('/posts',a.token,payload)).data.id,post.id);
 assert.equal((await req('/posts',a.token,{...payload,text:'Другой текст'})).status,409);
 assert.equal((await req('/posts',b.token,{...payload,client_id:randomUUID()})).status,400);
 assert.equal((await req(`/users/${a.user.id}/posts`,b.token)).data[0].attachment.id,file.id);
 const getFile=async token=>(await fetch(base+'/files/'+file.id,{headers:{Authorization:'Bearer '+token}})).status;
 assert.equal(await getFile(b.token),200);assert.equal((await req(`/posts/${post.id}/archive`,b.token,{archived:true})).status,404);
 assert.equal((await req(`/posts/${post.id}/archive`,a.token,{archived:true})).status,200);
 assert.equal((await req(`/users/${a.user.id}/posts`,b.token)).data.length,0);
 assert.equal((await req(`/users/${a.user.id}/posts?archive=1`,b.token)).status,403);
 assert.equal((await req(`/users/${a.user.id}/posts?archive=1`,a.token)).data[0].id,post.id);
 assert.equal(await getFile(b.token),404);assert.equal(await getFile(a.token),200);
 assert.equal((await req(`/uploads/${file.id}/discard`,a.token,{})).status,409);
 // Startup/periodic file collection must preserve archived publication files.
 app.db.prepare('UPDATE attachments SET created_at=0 WHERE id=?').run(file.id);
 const housekeeping=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'image/png','X-File-Name':'trigger.png'},body:bytes});assert.equal(housekeeping.status,201);assert.equal(await getFile(a.token),200);
 await req(`/posts/${post.id}/archive`,a.token,{archived:false});assert.equal(await getFile(b.token),200);
 await req(`/posts/${post.id}/delete`,a.token,{});assert.equal((await req(`/users/${a.user.id}/posts`,b.token)).data.length,0);assert.equal(await getFile(b.token),404);
 assert.equal((await req('/posts',a.token,payload)).status,409);
 assert.equal((await req('/posts',a.token,{text:' ',client_id:randomUUID()})).status,400);
 assert.equal((await req('/posts',a.token,{text:'x'.repeat(4001),client_id:randomUUID()})).status,400);
 assert.equal((await req(`/users/${a.user.id}/posts?before=bad`,b.token)).status,400);
});

test('profile posts: stable pagination and blocked profiles',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const register=async username=>{const r=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'password-long-enough'})});return r.json();};const a=await register('pagealice'),b=await register('pageboris');
 const get=async path=>{const r=await fetch(base+path,{headers:{Authorization:'Bearer '+b.token}});return {status:r.status,data:await r.json()};};
 const insert=app.db.prepare('INSERT INTO profile_posts(user_id,client_id,text,created) VALUES(?,?,?,?)');for(let i=0;i<35;i++)insert.run(a.user.id,randomUUID(),'Запись '+i,Date.now());
 const first=(await get(`/users/${a.user.id}/posts`)).data;assert.equal(first.length,30);
 const second=(await get(`/users/${a.user.id}/posts?before=${first.at(-1).id}`)).data;assert.equal(second.length,5);assert.equal(new Set([...first,...second].map(p=>p.id)).size,35);
 app.db.prepare('UPDATE users SET admin_blocked=1 WHERE id=?').run(a.user.id);assert.equal((await get(`/users/${a.user.id}/posts`)).status,404);
});
