import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
test('anchored media pages span albums and videos; cursors and file access stay scoped',async()=>{
 const uploads=mkdtempSync(join(tmpdir(),'volna-media-spec-')),app=createApp({database:':memory:',uploads});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const register=async name=>(await fixtureFetch(base+'/register',{method:'POST',body:JSON.stringify({username:name,name})})).json();
 const call=async(path,token,data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 try{
  const a=await register('mediaalice'),b=await register('mediabob'),c=await register('mediaeve'),chat=(await call('/chats',a.token,{user_id:b.user.id})).data.id,other=(await call('/chats',a.token,{user_id:c.user.id})).data.id;
  const r=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'image/png','X-File-Name':'photo.png'},body:readFileSync('client/public/icons/icon-192.png')}),file=await r.json();assert.equal(r.status,201);
  const videoId='f'.repeat(48);app.db.prepare('INSERT INTO attachments(id,owner_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)').run(videoId,a.user.id,'video.mp4','video/mp4',12,Date.now());
  const insert=app.db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at,attachment_id,album_id) VALUES(?,?,?,?,?,?,?)'),ids=[];
  for(let i=0;i<205;i++){const result=insert.run(chat,a.user.id,'Подпись '+i,randomUUID(),new Date().toISOString(),i===86?videoId:file.id,i>=83&&i<=85?'album':null);ids.push(Number(result.lastInsertRowid));}
  const foreign=Number(insert.run(other,a.user.id,'Foreign',randomUUID(),new Date().toISOString(),file.id,null).lastInsertRowid);
  const get=async q=>{const value=await call(`/chats/${chat}/media?type=photo_video&${q}`,b.token);assert.equal(value.status,200,JSON.stringify(value.data));return value.data;};
  const middle=await get('anchorMediaId=m'+ids[84]+'&direction=around&limit=31');assert.equal(middle.items.length,31);assert.equal(middle.items[15].messageId,ids[84]);assert.ok(middle.hasMoreBefore&&middle.hasMoreAfter);assert.equal(new Set(middle.items.map(m=>m.mediaId)).size,31);assert.ok(middle.items.some(m=>m.type==='video'));assert.equal(middle.items.find(m=>m.messageId===ids[85]).positionInAlbum,2);
  let before=middle,after=middle;const all=[...middle.items];while(before.hasMoreBefore){before=await get('cursor='+encodeURIComponent(before.beforeCursor));all.push(...before.items);}while(after.hasMoreAfter){after=await get('cursor='+encodeURIComponent(after.afterCursor));all.push(...after.items);}assert.equal(all.length,205);assert.equal(new Set(all.map(m=>m.mediaId)).size,205);assert.ok(all.every(m=>m.chatId===chat));
  assert.equal((await call(`/chats/${chat}/media?type=photo_video&cursor=${middle.beforeCursor}x`,b.token)).status,400);assert.equal((await call(`/chats/${other}/media?type=photo_video&cursor=${middle.beforeCursor}`,a.token)).status,400);assert.equal((await call(`/chats/${chat}/media?type=photo&cursor=${middle.beforeCursor}`,b.token)).status,400);assert.equal((await call(`/chats/${chat}/media?type=photo_video&anchorMediaId=m${foreign}`,b.token)).status,404);assert.equal((await call(`/chats/${chat}/media?type=photo_video`,c.token)).status,404);
  const photos=await call(`/chats/${chat}/media?type=photo&direction=around&anchorMediaId=m${ids[84]}`,b.token);assert.ok(photos.data.items.every(m=>m.type==='photo'));
  await call(`/messages/${ids[84]}/delete`,a.token,{});const denied=await fetch(base+`/files/${file.id}?message_id=${ids[84]}`,{headers:{Authorization:'Bearer '+b.token}});assert.equal(denied.status,404);assert.equal((await call(`/chats/${chat}/media?type=photo_video&anchorMediaId=m${ids[84]}`,b.token)).status,404);
  app.db.prepare('INSERT INTO chat_visibility(user_id,chat_id,hidden_before) VALUES(?,?,?)').run(b.user.id,chat,ids[100]);assert.equal((await fetch(base+`/files/${file.id}?message_id=${ids[20]}`,{headers:{Authorization:'Bearer '+b.token}})).status,404);
  app.db.prepare('DELETE FROM members WHERE chat_id=? AND user_id=?').run(chat,b.user.id);assert.equal((await call(`/chats/${chat}/media?type=photo_video&cursor=${middle.beforeCursor}`,b.token)).status,404);assert.equal((await fetch(base+`/files/${file.id}`,{headers:{Authorization:'Bearer '+b.token}})).status,404);
 }finally{await app.close();rmSync(uploads,{recursive:true,force:true});}
});
