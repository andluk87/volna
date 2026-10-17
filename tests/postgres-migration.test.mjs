import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {PostgresDatabase,postgresTestSchema} from '../server/database.mjs';
import {migrateSqliteToPostgres} from '../scripts/migrate-postgres.mjs';
import {translateSql,sqlParts} from '../server/database-sql.mjs';

const connectionString=process.env.VOLNA_TEST_DATABASE_URL;
test('SQL boundary preserves literals, distinguishes scalar max, splits PostgreSQL function bodies',()=>{
 assert.equal(translateSql("SELECT MAX(MAX(a,b)), 'INTEGER ? MAX(x,y);', ?"),"SELECT MAX(GREATEST(a,b)), 'INTEGER ? MAX(x,y);', $1");
 assert.equal(sqlParts("CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN PERFORM 1; END $fn$ LANGUAGE plpgsql; SELECT 1;").length,2);
});
test('SQLite migration preserves all tables, sessions, message IDs, uploads, contact secrets, timestamps and sequence high-water marks',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-pg-migrate-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=join(dir,'volna.db'),uploads=join(dir,'uploads');mkdirSync(uploads);
 const old=new DatabaseSync(source);old.function('casefold',v=>String(v).toLowerCase());old.exec(readFileSync(new URL('./fixtures/pre-postgres.sql',import.meta.url),'utf8'));
 const token='migration-session',hash=createHash('sha256').update(token).digest('hex'),file='a'.repeat(48);
 old.prepare('INSERT INTO users(id,username,name,phone) VALUES(?,?,?,?)').run(1500000001,'migration_user','Пользователь','+79000000001');
 old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash,1500000001,Date.now()+3600000);
 old.exec("INSERT INTO chats(id,pair) VALUES(21,'saved:1500000001'); INSERT INTO members(chat_id,user_id) VALUES(21,1500000001)");
 old.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run(file,1500000001,'test.txt','application/octet-stream',5,Date.now(),0);
 writeFileSync(join(uploads,file),'hello');
 old.prepare('INSERT INTO messages(id,chat_id,sender_id,text,client_id,created_at,attachment_id) VALUES(50,21,1500000001,?,?,?,?)').run('История без потерь',randomUUID(),'2026-10-17T01:02:03.000Z',file);
 old.prepare("UPDATE sqlite_sequence SET seq=900 WHERE name='messages'").run();
 old.prepare('INSERT INTO contact_secret VALUES(1,?)').run('preserved-contact-secret');
 old.exec("INSERT INTO auth_settings VALUES('phone-usernames-v1','done')");old.close();
 const schema=postgresTestSchema(source),result=migrateSqliteToPostgres({source,connectionString,schema});assert.equal(result.verified,true);assert.ok(result.tables>30);
 assert.ok(existsSync(source));assert.equal(readFileSync(join(uploads,file),'utf8'),'hello');
 assert.throws(()=>migrateSqliteToPostgres({source,connectionString,schema}),/not empty/);
 const app=createApp({database:source,uploads,newsEnabled:false});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 assert.equal(app.db.dialect,'postgres');assert.equal(app.db.prepare('SELECT secret FROM contact_secret WHERE id=1').get().secret,'preserved-contact-secret');
 const base=`http://127.0.0.1:${app.server.address().port}/api`,headers={Authorization:'Bearer '+token};
 const me=await fetch(base+'/me',{headers});assert.equal(me.status,200);assert.equal((await me.json()).id,1500000001);
 const messages=await fetch(base+'/chats/21/messages',{headers});assert.equal(messages.status,200);assert.equal((await messages.json())[0].text,'История без потерь');
 assert.equal(await (await fetch(base+'/files/'+file,{headers})).text(),'hello');
 const sent=await fetch(base+'/chats/21/messages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({text:'После миграции',client_id:randomUUID()})});assert.equal(sent.status,201);assert.equal((await sent.json()).id,901);
});
test('failed import rolls back PostgreSQL tables and leaves SQLite untouched',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-pg-rollback-')),source=join(dir,'volna.db'),schema=postgresTestSchema(source);
 try{const old=new DatabaseSync(source);old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,phone TEXT); INSERT INTO users VALUES(1,'+79000000001'); CREATE TABLE broken(value INTEGER); INSERT INTO broken VALUES('invalid-integer')");old.close();
  assert.throws(()=>migrateSqliteToPostgres({source,connectionString,schema}));
  const pg=new PostgresDatabase(connectionString,{schema});try{assert.equal(pg.prepare("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=current_schema()").get().n,0);}finally{pg.close();}
  const check=new DatabaseSync(source,{readOnly:true});assert.equal(check.prepare('SELECT value FROM broken').get().value,'invalid-integer');check.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('empty migrated users table retains the deleted-account sequence high-water mark',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-pg-sequence-')),source=join(dir,'volna.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(source);old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL); INSERT INTO users VALUES(6000000000,'deleted','Deleted','+79000000001');DELETE FROM users;");old.close();
 migrateSqliteToPostgres({source,connectionString,schema:postgresTestSchema(source)});
 const app=createApp({database:source,uploads:join(dir,'uploads'),newsEnabled:false});t.after(()=>app.close());
 assert.equal(app.db.prepare("SELECT id FROM users WHERE account_type='bot'").get().id,6000000001);
 const result=app.db.prepare('INSERT INTO users(username,name,phone) VALUES(?,?,?)').run('new_user','New','+79000000002');assert.equal(result.lastInsertRowid,6000000002);
});
