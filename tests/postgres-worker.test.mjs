import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';

test('PostgreSQL worker ignores stale notifications and correlates mixed exec/select responses',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE worker_race(id BIGINT PRIMARY KEY,value TEXT NOT NULL)');
 for(let n=1;n<=100;n++){
  // The worker can notify after its response has already been consumed.
  // Reproduce that delayed wakeup without relying on thread timing.
  Atomics.store(db.signal,0,1);Atomics.notify(db.signal,0);
  db.prepare('INSERT INTO worker_race VALUES(?,?)').run(n,'row-'+n);
  Atomics.store(db.signal,0,1);Atomics.notify(db.signal,0);
  assert.equal(db.prepare('SELECT value FROM worker_race WHERE id=?').get(n).value,'row-'+n);
  db.exec('BEGIN');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM worker_race').get().n,n);
  db.exec('COMMIT');
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM worker_race').get().n,100);
});
