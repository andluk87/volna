import {randomBytes,createHash} from 'node:crypto';
import {readdirSync,fstatSync,readFileSync,openSync,closeSync,constants} from 'node:fs';
import {dirname,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {CALL_LOG_BYTES} from './call-log.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const archive=/^volna-calls_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}Z_pid\d+_\d+\.log\.tar\.gz$/;
// Admin sessions protect management; a separately revocable token grants read-only log access.
export function callLogAccess({db,file,clock=Date.now}){
 db.exec('CREATE TABLE IF NOT EXISTS call_debug_shares(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL)');
 const cleanup=()=>db.prepare('DELETE FROM call_debug_shares WHERE expires<=?').run(clock());
 function files(){
  if(!file)return [];
  try{return readdirSync(dirname(file)).filter(name=>name==='volna-calls.log'||archive.test(name)).map(name=>{const path=join(dirname(file),name);let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);return s.isFile()?{name,size:s.size,modified:s.mtimeMs}:null;}catch{return null;}finally{if(fd!==undefined)closeSync(fd);}}).filter(Boolean).sort((a,b)=>b.modified-a.modified||b.name.localeCompare(a.name)).slice(0,100);}catch(error){if(error.code==='ENOENT')return [];throw fail(503,'Журнал звонков недоступен');}
 }
 function read(name){
  if(!file||!(name==='volna-calls.log'||archive.test(name)))throw fail(404,'Журнал не найден');
  let fd;try{fd=openSync(join(dirname(file),name),constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd);if(!s.isFile()||s.size>CALL_LOG_BYTES*2)throw fail(413,'Файл журнала превышает допустимый размер');return readFileSync(fd);}catch(error){if(error.status)throw error;throw fail(404,'Журнал не найден');}finally{if(fd!==undefined)closeSync(fd);}
 }
 function recent(){
  const entries=files(),names=entries.filter(x=>archive.test(x.name)).slice(0,2).reverse().map(x=>x.name);if(entries.some(x=>x.name==='volna-calls.log'))names.push('volna-calls.log');
  const chunks=[];for(const name of names){let bytes=read(name);if(archive.test(name)){try{const tar=gunzipSync(bytes,{maxOutputLength:CALL_LOG_BYTES*2}),size=parseInt(tar.subarray(124,136).toString('ascii').replace(/\0.*$/,''),8);if(tar.subarray(0,100).toString().replace(/\0.*$/,'')!=='volna-calls.log'||!Number.isSafeInteger(size)||size>CALL_LOG_BYTES||size+512>tar.length)throw Error();bytes=tar.subarray(512,512+size);}catch{chunks.push(JSON.stringify({event:'log.archive_unreadable',archive:name}));continue;}}chunks.push(bytes.toString('utf8').trimEnd());}
  return chunks.filter(Boolean).join('\n')+'\n';
 }
 function send(res,bytes,name,type='text/plain; charset=utf-8',download=false){res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.writeHead(200,{'Content-Type':type,...(download?{'Content-Disposition':`attachment; filename="${name}"`}:{})});res.end(bytes);}
 function createShare(audit=()=>{}){
  const token=randomBytes(32).toString('base64url'),id=randomBytes(16).toString('hex'),created=clock(),expires=created+86400000;
  db.prepare('DELETE FROM call_debug_shares').run();db.prepare('INSERT INTO call_debug_shares VALUES(?,?,?,?)').run(id,hash(token),created,expires);audit('call.debug.share',id,'Временный доступ к журналу звонков',{expires});return {path:'/api/call-debug/'+token,expires};
 }
 function revoke(audit=()=>{}){db.prepare('DELETE FROM call_debug_shares').run();audit('call.debug.revoke','all','Доступ к журналу отозван');}
 async function admin(req,res,url,json,audit){
  const path=url.pathname;if(!path.startsWith('/admin/api/call-debug'))return false;
  cleanup();
  if(path==='/admin/api/call-debug'&&req.method==='GET'){json(res,200,{text:recent().split('\n').slice(-301).join('\n'),files:files(),shares:db.prepare('SELECT id,created,expires FROM call_debug_shares').all()});return true;}
  if(path==='/admin/api/call-debug/download'&&req.method==='GET'){const name=url.searchParams.get('file');if(name)send(res,read(name),name,name.endsWith('.gz')?'application/gzip':'text/plain; charset=utf-8',true);else send(res,recent(),'volna-calls-recent.log','text/plain; charset=utf-8',true);return true;}
  if(path==='/admin/api/call-debug/share'&&req.method==='POST'){json(res,200,createShare(audit));return true;}
  if(path==='/admin/api/call-debug/revoke'&&req.method==='POST'){revoke(audit);json(res,200,{ok:true});return true;}
  throw fail(404,'Не найдено');
 }
 function publicHandle(req,res,url){
  if(!url.pathname.startsWith('/api/call-debug/'))return false;
  const token=url.pathname.slice('/api/call-debug/'.length);if(!['GET','HEAD'].includes(req.method)||!/^[A-Za-z0-9_-]{43}$/.test(token)||!db.prepare('SELECT id FROM call_debug_shares WHERE token_hash=? AND expires>?').get(hash(token),clock()))throw fail(404,'Ссылка недействительна или срок доступа истёк');
  send(res,req.method==='HEAD'?'':recent(),'volna-calls-recent.log');return true;
 }
 return {admin,publicHandle,cleanup,createShare,revoke};
}
