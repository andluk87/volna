import pg from 'pg';
import {Worker,MessageChannel,receiveMessageOnPort} from 'node:worker_threads';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// PostgreSQL I/O lives in a worker. This deliberately preserves the synchronous
// services and their uninterrupted transaction blocks; it is not an async pool.
export class PostgresDatabase {
 constructor(connectionString,{schema}={}){
  if(!/^postgres(?:ql)?:\/\//.test(connectionString||''))throw Error('Set DATABASE_URL to a PostgreSQL connection URL');
  this.connectionString=connectionString;this.schema=schema;this.dialect='postgres';
  const {port1,port2}=new MessageChannel();this.port=port1;this.signal=new Int32Array(new SharedArrayBuffer(4));
  this.worker=new Worker(new URL('./database-worker.mjs',import.meta.url),{workerData:{connectionString,schema,port:port2,signal:this.signal.buffer},transferList:[port2],execArgv:[]});
  this.worker.unref();this.port.unref();this.sequence=0;
  try{this.receive(0);}catch(e){this.worker.terminate();throw e;}
 }
 receive(expected){
  const deadline=Date.now()+45000;
  for(;;){
   // The port is the source of truth. A notification may arrive after its
   // message was already read, so clear the flag BEFORE checking the queue.
   Atomics.store(this.signal,0,0);
   const packet=receiveMessageOnPort(this.port);
   if(packet){
    const response=packet.message;
    if(response.id!==expected){this.closed=true;this.worker.terminate();throw Error('PostgreSQL worker response mismatch; restart the server before retrying writes');}
    if(response.error)throw Object.assign(Error(response.error.message),response.error);
    return response.result;
   }
   const remaining=deadline-Date.now();
   if(remaining<=0){this.closed=true;this.worker.terminate();throw Error('PostgreSQL worker timed out; restart the server before retrying writes');}
   Atomics.wait(this.signal,0,0,remaining);
  }
 }
 request(op,sql,params){if(this.closed)throw Error('Database is closed');const id=++this.sequence;this.port.postMessage({id,op,sql,params});return this.receive(id);}
 exec(sql){this.request('exec',sql);}
 prepare(sql){return {all:(...params)=>this.request('all',sql,params),get:(...params)=>this.request('all',sql,params)[0],run:(...params)=>this.request('run',sql,params)};}
 columns(table){return this.prepare('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? ORDER BY ordinal_position').all(table);}
 hasTable(table){return !!this.prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?').get(table);}
 get schemaVersion(){return this.prepare('SELECT version FROM volna_schema_metadata WHERE id=1').get().version;}
 set schemaVersion(version){this.prepare('UPDATE volna_schema_metadata SET version=? WHERE id=1').run(version);}
 async backup(path,{onSnapshot=()=>{}}={}){
  const client=new pg.Client({connectionString:this.connectionString,connectionTimeoutMillis:10000,application_name:'volna-backup'});
  const safeUrl=new URL(this.connectionString),password=decodeURIComponent(safeUrl.password);safeUrl.password='';
  try{
   await client.connect();
   if(this.schema)await client.query(`SET search_path TO "${this.schema}", public`);
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
   const files=(await client.query('SELECT id FROM attachments')).rows.map(row=>row.id);
   await onSnapshot(files);
   await run('pg_dump',['--dbname',safeUrl.toString(),'--format=custom','--file',path,'--snapshot',snapshot,...(this.schema?['--schema',this.schema]:[])],{env:{...process.env,PGPASSWORD:password},timeout:600000,maxBuffer:1024*1024});
   await client.query('COMMIT');
  }finally{await client.end().catch(()=>{});}
 }
 close(){if(this.closed)return;try{this.request('close');}finally{this.closed=true;this.port.close();this.worker.terminate();}}
}
export const postgresTestSchema=database=>'volna_test_'+(database===':memory:'?randomBytes(12).toString('hex'):createHash('sha256').update(database).digest('hex').slice(0,24));
export function openDatabase(database){
 const url=process.env.VOLNA_TEST_DATABASE_URL||(/^postgres(?:ql)?:\/\//.test(database||'')?database:process.env.DATABASE_URL);
 if(!url)throw Error('DATABASE_URL is required. Migrate the existing SQLite database before starting PostgreSQL.');
 const schema=process.env.VOLNA_TEST_DATABASE_URL?postgresTestSchema(database):undefined;
 const db=new PostgresDatabase(url,{schema});
 const source=database||process.env.DB_PATH;
 if(!process.env.VOLNA_TEST_DATABASE_URL&&source&&!/^postgres/.test(source)&&existsSync(source)&&statSync(source).size>0&&!db.hasTable('volna_storage_migrations')){
  db.close();throw Error('Existing SQLite database detected: migrate to PostgreSQL before starting.');
 }
 db.exec('CREATE TABLE IF NOT EXISTS volna_schema_metadata(id BIGINT PRIMARY KEY CHECK(id=1),version BIGINT NOT NULL)');
 db.prepare('INSERT INTO volna_schema_metadata VALUES(1,1) ON CONFLICT DO NOTHING').run();
 return db;
}
