import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
test('official news is readable, illustrated, idempotent across restarts and never re-enrolls a departed user',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'volna-news-'));let app=createApp({database:join(directory,'news.db'),uploads:join(directory,'files'),newsEnabled:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 let base=`http://127.0.0.1:${app.server.address().port}/api`;const req=async(path,token='',data)=>{const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};};
 try{const session=(await req('/register','',{username:'news_reader',name:'Читатель',password:'long-test-password'})).data;const channels=(await req('/chats',session.token)).data;const news=channels.find(c=>c.name==='Волна — новости');assert.ok(news);assert.equal(news.kind,'channel');assert.equal(news.can_send,0);const posts=(await req(`/chats/${news.id}/messages`,session.token)).data;assert.equal(posts.length,1);assert.match(posts[0].text,/🌊/);assert.match(posts[0].text,/0\.12\.30/);assert.equal(posts[0].attachment.mime,'image/jpeg');assert.ok(posts[0].attachment.size<500000);
 assert.equal((await req(`/chats/${news.id}/messages`,session.token,{text:'Подмена',client_id:'attempt'})).status,403);
 app.db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(news.id,session.user.id);await req('/me',session.token);assert.equal(app.db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(news.id,session.user.id),undefined);
 await app.close();app=createApp({database:join(directory,'news.db'),uploads:join(directory,'files'),newsEnabled:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}/api`;assert.equal(app.db.prepare('SELECT COUNT(*) n FROM messages WHERE chat_id=?').get(news.id).n,1);assert.equal(app.db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').get(news.id,session.user.id),undefined);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
