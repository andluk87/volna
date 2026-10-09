import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

async function listen(app){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;}

test('startup and subsequent uploads retain old pack, avatar, message and foreign-key files but remove expired unused uploads',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'volna-cleanup-')),database=join(directory,'volna.db'),uploads=join(directory,'uploads');
 mkdirSync(uploads);let app;
 try{
  app=createApp({database,uploads});await listen(app);
  app.db.prepare('INSERT INTO users(id,username,name,phone) VALUES(1,?,?,?)').run('cleanup','Cleanup','+79001234567');
  const old=Date.now()-2*86400000,ids={};let counter=1;
  function attachment(name,created=old){const id=(counter++).toString(16).padStart(48,'0');ids[name]=id;const bytes=Buffer.from('original '+name);writeFileSync(join(uploads,id),bytes);app.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run(id,1,name,'image/png',bytes.length,created);return id;}
  for(const [index,kind] of ['emoji','sticker','gif'].entries()){
   const pack=(index+1).toString(16).padStart(32,'0'),item=(index+10).toString(16).padStart(32,'0');
   app.db.prepare('INSERT INTO expression_packs(id,owner_id,title,kind,public,created) VALUES(?,1,?,?,1,?)').run(pack,kind,kind,old);
   app.db.prepare('INSERT INTO expression_items VALUES(?,?,?,?,?,?,?)').run(item,pack,attachment(kind),kind,kind,'✨',0);
  }
  app.db.prepare('UPDATE users SET avatar_id=? WHERE id=1').run(attachment('avatar'));
  app.db.exec("INSERT INTO chats(id,pair) VALUES(1,'cleanup'); INSERT INTO members(chat_id,user_id) VALUES(1,1)");
  app.db.prepare('INSERT INTO messages(chat_id,sender_id,text,client_id,created_at,attachment_id) VALUES(1,1,?,?,?,?)').run('retained message','cleanup-message-id',new Date(old).toISOString(),attachment('message'));
  // Additional FK references must never result in an unlink before SQLite rejects deletion.
  app.db.exec('CREATE TABLE retained_media(id INTEGER PRIMARY KEY, attachment_id TEXT REFERENCES attachments(id))');
  app.db.prepare('INSERT INTO retained_media(attachment_id) VALUES(?)').run(attachment('foreign-key'));
  attachment('unused');attachment('recent',Date.now());
  attachment('missing');unlinkSync(join(uploads,ids.missing));
  attachment('blocked-path');unlinkSync(join(uploads,ids['blocked-path']));mkdirSync(join(uploads,ids['blocked-path']));
  await app.close();app=null;
  for(let restart=0;restart<2;restart++){
   app=createApp({database,uploads});const base=await listen(app);
   assert.equal((await fetch(base+'/api/health')).status,200);
   for(const name of ['emoji','sticker','gif','avatar','message','foreign-key','recent']){
    assert.ok(app.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(ids[name]),name+' database row');
    assert.equal(readFileSync(join(uploads,ids[name]),'utf8'),'original '+name,name+' bytes');
   }
   assert.equal(app.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(ids.unused),undefined);
   assert.equal(existsSync(join(uploads,ids.unused)),false);
   assert.equal(app.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(ids.missing),undefined);
   assert.ok(app.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(ids['blocked-path']),'failed unlink restores the attachment row');
   assert.ok(existsSync(join(uploads,ids['blocked-path'])));
   assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
   // Exercise the same collector on upload, after the server has started.
   const token='cleanup-session-token';
   const {createHash}=await import('node:crypto');app.db.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires) VALUES(?,1,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);
   const upload=await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'image/png','X-File-Name':'new.png'},body:Buffer.from('new upload')});assert.equal(upload.status,201);await upload.json();
   assert.equal(readFileSync(join(uploads,ids['foreign-key']),'utf8'),'original foreign-key');
   await app.close();app=null;
  }
 }finally{if(app)await app.close();rmSync(directory,{recursive:true,force:true});}
});
