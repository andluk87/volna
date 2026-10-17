import {DatabaseSync} from 'node:sqlite';
import {PostgresDatabase} from '../server/database.mjs';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const quote=name=>'"'+String(name).replaceAll('"','""')+'"';
const verifier=()=>{
 let count=0,sum=0n;const modulus=1n<<256n;
 return {add(row){const canonical=JSON.stringify(Object.keys(row).sort().map(key=>[key,row[key] instanceof Uint8Array?Buffer.from(row[key]).toString('hex'):row[key]]));sum=(sum+BigInt('0x'+createHash('sha256').update(canonical).digest('hex')))%modulus;count++;},get signature(){return count+':'+sum.toString(16);}};
};
// The messenger must be stopped. This utility never edits or removes the source.
// DDL, copied rows, constraints, sequences and the completion marker commit together.
export function migrateSqliteToPostgres({source,connectionString=process.env.DATABASE_URL,schema,onTable=()=>{}}){
 if(!source||!existsSync(source))throw Error('SQLite source does not exist');
 const sqlite=new DatabaseSync(source,{readOnly:true});let target;
 try{
  sqlite.exec('BEGIN');
  if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity check failed');
  if(sqlite.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign key check failed; repair the source before migration');
  if(!sqlite.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='phone'))throw Error('Legacy authentication: upgrade the SQLite installation before this migration');
  target=new PostgresDatabase(connectionString,{schema});
  target.exec('BEGIN');
  target.prepare('SELECT pg_advisory_xact_lock(?)').get(867460120);
  if(target.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' LIMIT 1").get())throw Error('Target PostgreSQL schema is not empty; migration refuses to overwrite data');
  const tables=sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  for(const table of tables){
   // Recreate FKs after copying all tables so cycles and SQLite creation order work.
   const ddl=table.sql.replace(/\s+REFERENCES\s+[\w"]+\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:NO ACTION|RESTRICT|SET NULL|SET DEFAULT|CASCADE))*/gi,'');
   if(/\bFOREIGN KEY\b/i.test(ddl))throw Error('Unsupported table-level foreign key in '+table.name);
   target.exec(ddl);
   if(table.name==='reactions')target.exec('ALTER TABLE reactions ADD COLUMN reaction_order BIGINT GENERATED ALWAYS AS IDENTITY');
   const columns=sqlite.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map(c=>c.name);
   const names=columns.map(quote).join(',');const select=`SELECT ${names} FROM ${quote(table.name)}`;
   const sourceSelect=select+(table.name==='reactions'?' ORDER BY rowid':'');
   const expected=verifier(),actual=verifier();let batch=[],count=0;
   const flush=()=>{if(!batch.length)return;const values=batch.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',');target.prepare(`INSERT INTO ${quote(table.name)}(${names}) VALUES${values}`).run(...batch.flat());batch=[];};
   for(const row of sqlite.prepare(sourceSelect).iterate()){expected.add(row);batch.push(columns.map(c=>row[c]));count++;if(batch.length===250)flush();}flush();
   target.exec(`DECLARE volna_verify NO SCROLL CURSOR FOR ${select}`);
   for(;;){const rows=target.prepare('FETCH FORWARD 1000 FROM volna_verify').all();if(!rows.length)break;for(const row of rows)actual.add(row);}
   target.exec('CLOSE volna_verify');
   if(expected.signature!==actual.signature)throw Error('Data verification failed for '+table.name);
   onTable({table:table.name,rows:count});
  }
  for(const table of tables){
   const foreign=sqlite.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all();
   const grouped=Map.groupBy(foreign,key=>key.id);
   for(const [id,entries] of grouped){entries.sort((a,b)=>a.seq-b.seq);const ref=entries[0];
    const allowed=new Set(['NO ACTION','RESTRICT','SET NULL','SET DEFAULT','CASCADE']);
    if(!allowed.has(ref.on_delete)||!allowed.has(ref.on_update))throw Error('Unsupported foreign key action');
    target.exec(`ALTER TABLE ${quote(table.name)} ADD CONSTRAINT ${quote('migrated_fk_'+table.name+'_'+id)} FOREIGN KEY (${entries.map(x=>quote(x.from)).join(',')}) REFERENCES ${quote(ref.table)} (${entries.map(x=>quote(x.to)).join(',')}) ON DELETE ${ref.on_delete} ON UPDATE ${ref.on_update}`);
   }
  }
  for(const index of sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all())target.exec(index.sql);
  // Preserve high-water marks even when the highest account/message was deleted.
  const sequences=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()?sqlite.prepare('SELECT name,seq FROM sqlite_sequence').all():[];
  for(const c of target.prepare("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND is_identity='YES'").all()){
   const max=target.prepare(`SELECT COALESCE(MAX(${quote(c.column_name)}),0) AS n FROM ${quote(c.table_name)}`).get().n;
   const high=Math.max(max,sequences.find(s=>s.name===c.table_name)?.seq||0);
   target.prepare('SELECT setval(pg_get_serial_sequence(?,?),?,?)').get(quote(c.table_name),c.column_name,Math.max(high,1),high>0);
  }
  target.exec('CREATE TABLE volna_storage_migrations(version BIGINT PRIMARY KEY,completed_at TEXT NOT NULL)');
  target.prepare('INSERT INTO volna_storage_migrations VALUES(1,?)').run(new Date().toISOString());
  target.exec('COMMIT');sqlite.exec('ROLLBACK');return {tables:tables.length,verified:true};
 }catch(error){try{target?.exec('ROLLBACK');}catch{}throw error;}
 finally{target?.close();sqlite.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const source=process.argv[2];if(process.argv.length!==3)throw Error('Usage: DATABASE_URL=... node scripts/migrate-postgres.mjs /path/to/volna.db');const result=migrateSqliteToPostgres({source,onTable:row=>console.log(`${row.table}: ${row.rows} rows verified`)});console.log(`Migration committed: ${result.tables} tables. Original SQLite file and uploads retained.`);}
 catch(error){console.error('Migration aborted:',error.code?`PostgreSQL ${error.code}`:error.message);process.exitCode=1;}
}
