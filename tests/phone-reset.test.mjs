import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,readdirSync,existsSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {createApp} from '../server/index.mjs';
test('legacy reset requires explicit action, produces an intact backup, rejects old tokens and is idempotent',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-reset-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const database=join(dir,'volna.db');
 const old=new DatabaseSync(database);old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,salt TEXT,hash TEXT);INSERT INTO users VALUES(1,'old','salt','hash');CREATE TABLE sessions(token TEXT,user_id INTEGER,expires INTEGER);INSERT INTO sessions VALUES('old-secret',1,9999999999999)");old.close();
 mkdirSync(join(dir,'uploads'));writeFileSync(join(dir,'uploads','old-file'),'old-private-media');
 assert.throws(()=>createApp({database}),/legacy|migration|migrate/i);assert.ok(existsSync(database));
 const run=()=>spawnSync(process.execPath,['server/reset-phone-auth.mjs','--reset-legacy'],{env:{...process.env,DB_PATH:database},encoding:'utf8'});
 const result=run();assert.equal(result.status,0,result.stderr);assert.equal(existsSync(database),false);
 const backup=join(dir,'legacy-auth-backups',readdirSync(join(dir,'legacy-auth-backups'))[0]);const snap=new DatabaseSync(join(backup,'legacy.db'),{readOnly:true});assert.equal(snap.prepare('SELECT username FROM users').get().username,'old');snap.close();assert.ok(existsSync(join(backup,'uploads','old-file')));
 const app=createApp({database});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
 const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/me`,{headers:{Authorization:'Bearer old-secret'}});assert.equal(response.status,401);
 assert.equal(run().status,0);assert.equal(readdirSync(join(dir,'legacy-auth-backups')).length,1);assert.ok(existsSync(database));
});
