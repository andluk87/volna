import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {normalizePhone} from './phone-auth.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const cleanName=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,100);
export function contacts({db,body,json,publish,userById}) {
 db.exec(`CREATE TABLE IF NOT EXISTS contact_settings(owner INTEGER PRIMARY KEY REFERENCES users(id),enabled INTEGER NOT NULL DEFAULT 0,epoch INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 0,discovery TEXT NOT NULL DEFAULT 'everyone',presence TEXT NOT NULL DEFAULT 'everyone');
 CREATE TABLE IF NOT EXISTS account_contacts(owner INTEGER NOT NULL REFERENCES users(id),id TEXT NOT NULL,linked INTEGER REFERENCES users(id),phones TEXT NOT NULL DEFAULT '[]',phonebook_name TEXT NOT NULL DEFAULT '',custom_name TEXT NOT NULL DEFAULT '',manual INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,id));
 CREATE INDEX IF NOT EXISTS contact_links ON account_contacts(owner,linked,deleted);
 CREATE TABLE IF NOT EXISTS contact_sources(owner INTEGER NOT NULL,device TEXT NOT NULL,source TEXT NOT NULL,contact_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(owner,device,source));
 CREATE TABLE IF NOT EXISTS contact_devices(owner INTEGER NOT NULL,device TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(owner,device));
 CREATE TABLE IF NOT EXISTS contact_queries(owner INTEGER NOT NULL,fingerprint TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,fingerprint));
 CREATE TABLE IF NOT EXISTS contact_operations(owner INTEGER NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,key));
 CREATE TABLE IF NOT EXISTS contact_secret(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(contact_settings)').all().some(c=>c.name==='presence'))db.exec("ALTER TABLE contact_settings ADD COLUMN presence TEXT NOT NULL DEFAULT 'everyone'");
 if(!db.prepare('PRAGMA table_info(contact_sources)').all().some(c=>c.name==='data'))db.exec("ALTER TABLE contact_sources ADD COLUMN data TEXT NOT NULL DEFAULT '{}'");
 const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(x=>x.name));
 if(!columns.has('phone_verified_at'))db.exec('ALTER TABLE users ADD COLUMN phone_verified_at INTEGER NOT NULL DEFAULT 0');
 db.exec("UPDATE users SET phone_verified_at=MAX(COALESCE((SELECT MAX(created) FROM sms_challenges WHERE phone=users.phone AND status='verified'),0),COALESCE((SELECT MAX(created) FROM refresh_sessions WHERE user_id=users.id AND platform='android'),0)) WHERE phone_verified_at=0");
 db.prepare('INSERT OR IGNORE INTO contact_secret VALUES(1,?)').run(randomBytes(32).toString('hex'));
 const secret=db.prepare('SELECT secret FROM contact_secret').get().secret;
 const fingerprint=value=>createHmac('sha256',secret).update(value).digest('hex');
 const buckets=new Map();
 const rate=(uid,kind,max,window=60000)=>{const key=uid+':'+kind,now=Date.now();let b=buckets.get(key);if(!b||b.until<now){b={count:0,until:now+window};buckets.set(key,b);}if(++b.count>max)throw fail(429,'Слишком много запросов контактов. Повторите позже');if(buckets.size>10000)for(const[k,v]of buckets)if(v.until<now)buckets.delete(k);};
 const settings=uid=>{db.prepare('INSERT OR IGNORE INTO contact_settings(owner) VALUES(?)').run(uid);return db.prepare('SELECT * FROM contact_settings WHERE owner=?').get(uid);};
 const next=uid=>{db.prepare('UPDATE contact_settings SET version=version+1 WHERE owner=?').run(uid);return settings(uid).version;};
 const changed=uid=>publish([uid],{type:'contacts',version:settings(uid).version});
 const device=value=>{if(typeof value!=='string'||!value.match(/^[a-zA-Z0-9_-]{16,80}$/))throw fail(400,'Некорректное устройство контактов');return value;};
 const phones=values=>{if(!Array.isArray(values)||!values.length||values.length>10)throw fail(400,'Укажите от 1 до 10 номеров');return [...new Set(values.map(normalizePhone))].sort();};
 function discover(uid,phone){
  const row=db.prepare('SELECT id FROM users WHERE phone=? AND phone_verified_at>0 AND id<>? AND admin_blocked=0').get(phone,uid);if(!row)return null;
  const policy=settings(row.id).discovery;
  if(policy==='nobody')return null;
  if(policy==='contacts'){
   const ownPhone=db.prepare('SELECT phone FROM users WHERE id=?').get(uid)?.phone;
   if(!db.prepare('SELECT 1 FROM account_contacts c,json_each(c.phones) p WHERE c.owner=? AND c.deleted=0 AND p.value=?').get(row.id,ownPhone))return null;
  }
  return row.id;
 }
 function budget(uid,values){
  const now=Date.now();db.prepare('DELETE FROM contact_queries WHERE created<?').run(now-86400000);
  let count=db.prepare('SELECT COUNT(*) AS n FROM contact_queries WHERE owner=?').get(uid).n;
  for(const phone of new Set(values)){if(db.prepare('SELECT 1 FROM account_contacts c,json_each(c.phones) p WHERE c.owner=? AND c.deleted=0 AND p.value=?').get(uid,phone))continue;const key=fingerprint(phone);if(db.prepare('SELECT 1 FROM contact_queries WHERE owner=? AND fingerprint=?').get(uid,key))continue;
   if(++count>2000)throw fail(429,'Дневной лимит поиска контактов исчерпан');
   db.prepare('INSERT INTO contact_queries VALUES(?,?,?)').run(uid,key,now);
  }
 }
 function display(uid,id,fallback){const c=db.prepare("SELECT custom_name,phonebook_name FROM account_contacts WHERE owner=? AND linked=? AND deleted=0 ORDER BY (custom_name!='') DESC,version DESC,id LIMIT 1").get(uid,id);return c?.custom_name||c?.phonebook_name||fallback;}
 function canSeePresence(viewer,target){if(viewer===target)return true;const policy=settings(target).presence;if(policy==='everyone')return true;if(policy==='nobody')return false;return !!db.prepare('SELECT 1 FROM account_contacts c LEFT JOIN json_each(c.phones) p WHERE c.owner=? AND c.deleted=0 AND (c.linked=? OR p.value=(SELECT phone FROM users WHERE id=?))').get(target,viewer,viewer);}
 function personalize(uid,value){
  if(!uid||value==null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(x=>personalize(uid,x));
  const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,personalize(uid,v)]));
  if(result.id&&result.username&&typeof result.online==='boolean'&&result.id!==uid){if(!canSeePresence(uid,result.id))result.online=false;}
  if(result.id&&result.username&&typeof result.name==='string'){const name=display(uid,result.id,result.name);if(name!==result.name){result.profile_name=result.name;result.name=name;}}
  if(result.kind==='direct'&&result.peer_id){if(typeof result.name==='string'){const name=display(uid,result.peer_id,result.name);if(name!==result.name)result.profile_name=result.name;result.name=name;}if(!canSeePresence(uid,result.peer_id))result.peer_online=false;}
  if(result.sender_id&&typeof result.sender_name==='string')result.sender_name=display(uid,result.sender_id,result.sender_name);
  if(result.sender_id&&typeof result.name==='string')result.name=display(uid,result.sender_id,result.name);
  return result;
 }
 function entries(uid,since=0){return db.prepare('SELECT * FROM account_contacts WHERE owner=? AND version>? ORDER BY version,id').all(uid,since).map(c=>({contact_id:c.id,linked_user_id:c.linked,phone_numbers:JSON.parse(c.phones),phonebook_name:c.phonebook_name,custom_name:c.custom_name,display_name:display(uid,c.linked,c.custom_name||c.phonebook_name||(c.linked?userById(c.linked)?.name:'')||JSON.parse(c.phones)[0]||''),version:c.version,updated_at:c.updated,deleted:!!c.deleted,user:c.linked&&!c.deleted?personalize(uid,userById(c.linked)):null}));}
 function find(uid,ps,linked){return (linked?db.prepare('SELECT * FROM account_contacts WHERE owner=? AND linked=? AND deleted=0 ORDER BY version DESC LIMIT 1').get(uid,linked):null)||db.prepare('SELECT DISTINCT c.* FROM account_contacts c,json_each(c.phones) p WHERE c.owner=? AND c.deleted=0 AND p.value IN ('+ps.map(()=>'?').join(',')+') LIMIT 1').get(uid,...ps);}
 function upsert(uid,data,manual=false){
  const ps=phones(data.phone_numbers),linked=ps.map(p=>discover(uid,p)).find(Boolean)||null;
  let existing=find(uid,ps,linked);
  if(!existing){const dead=db.prepare('SELECT c.id FROM account_contacts c,json_each(c.phones) p WHERE c.owner=? AND c.deleted=1 AND p.value IN ('+ps.map(()=>'?').join(',')+')').get(uid,...ps);if(dead&&!manual)return null;}
  const id=existing?.id||randomUUID(),merged=existing?[...new Set([...JSON.parse(existing.phones),...ps])].sort().slice(0,10):ps;
  const name=cleanName(data.phonebook_name)||existing?.phonebook_name||'';if(existing&&existing.phones===JSON.stringify(merged)&&existing.phonebook_name===name&&(!manual||existing.manual)&&(!linked||existing.linked))return id;const version=next(uid);
  db.prepare(`INSERT INTO account_contacts(owner,id,linked,phones,phonebook_name,manual,version,updated) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET linked=COALESCE(account_contacts.linked,excluded.linked),phones=excluded.phones,phonebook_name=excluded.phonebook_name,manual=MAX(account_contacts.manual,excluded.manual),version=excluded.version,updated=excluded.updated`).run(uid,id,linked,JSON.stringify(merged),name,manual?1:0,version,Date.now());return id;
 }
 function mergeSources(uid,id){
  const c=db.prepare('SELECT * FROM account_contacts WHERE owner=? AND id=? AND deleted=0').get(uid,id);if(!c)return;
  const sources=db.prepare('SELECT data FROM contact_sources WHERE owner=? AND contact_id=? ORDER BY device,source').all(uid,id).map(x=>JSON.parse(x.data));
  if(!sources.length)return;
  const ps=[...new Set([...(c.manual?JSON.parse(c.phones):[]),...sources.flatMap(x=>x.phone_numbers||[])])].sort().slice(0,10);
  const name=sources.map(x=>x.phonebook_name).find(Boolean)||'';
  if(JSON.stringify(ps)!==c.phones||name!==c.phonebook_name)db.prepare('UPDATE account_contacts SET phones=?,phonebook_name=?,version=?,updated=? WHERE owner=? AND id=?').run(JSON.stringify(ps),name,next(uid),Date.now(),uid,id);
 }
 async function handle(req,res,url,uid){
  const path=url.pathname,method=req.method;
  let operation=null;
  const respond=(res,status,result)=>{if(operation&&status<300)db.prepare('INSERT OR IGNORE INTO contact_operations VALUES(?,?,?,?,?)').run(uid,operation.key,operation.fingerprint,JSON.stringify({status,result:result?.contact_id?{contact_id:result.contact_id}:result}),Date.now());json(res,status,result);};
  if(method==='POST'&&path.startsWith('/api/contacts/')){rate(uid,'write',120);const data=await body(req);req.volnaParsedBody=data;if(data.request_id!==undefined){if(typeof data.request_id!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(data.request_id))throw fail(400,'Некорректный идентификатор операции');operation={key:data.request_id,fingerprint:fingerprint(path+'\0'+JSON.stringify(data))};const old=db.prepare('SELECT * FROM contact_operations WHERE owner=? AND key=?').get(uid,operation.key);if(old){if(old.fingerprint!==operation.fingerprint)throw fail(409,'Идентификатор операции уже использован');const cached=JSON.parse(old.result);json(res,cached.status,cached.result?.contact_id?entries(uid).find(c=>c.contact_id===cached.result.contact_id)||{contact_id:cached.result.contact_id,deleted:true}:cached.result);return true;}}}

  // Intercept all legacy phone searches before username search; prefixes never enumerate users.
  if(['/api/users','/api/users/search'].includes(path)&&method==='GET'){
   const raw=String(url.searchParams.get('q')||'').trim();if(!/^[+0-9\s().-]+$/.test(raw)||!raw)return false;
   rate(uid,'lookup',5);let phone;try{phone=normalizePhone(raw.startsWith('+')?raw:'+'+raw);}catch{respond(res,200,path.endsWith('/search')?{users:[]}:[]);return true;}
   budget(uid,[phone]);const id=discover(uid,phone),users=id?[personalize(uid,userById(id))]:[];respond(res,200,path.endsWith('/search')?{users}:users);return true;
  }
  if(path==='/api/contacts'&&method==='GET'){
   const ids=db.prepare("SELECT linked AS id FROM account_contacts WHERE owner=? AND deleted=0 AND linked IS NOT NULL UNION SELECT peer.user_id AS id FROM members me JOIN members peer ON me.chat_id=peer.chat_id JOIN chats c ON c.id=me.chat_id WHERE me.user_id=? AND peer.user_id<>? AND c.kind='direct'").all(uid,uid,uid);
   respond(res,200,ids.map(({id})=>personalize(uid,userById(id))));return true;
  }
  if(!path.startsWith('/api/contacts/'))return false;
  const config=settings(uid);
  if(path==='/api/contacts/book'&&method==='GET'){
   const since=Number(url.searchParams.get('since')||0);if(!Number.isSafeInteger(since)||since<0)throw fail(400,'Некорректная версия');
   for(const c of db.prepare('SELECT * FROM account_contacts WHERE owner=? AND linked IS NULL AND deleted=0').all(uid)){const linked=JSON.parse(c.phones).map(p=>discover(uid,p)).find(Boolean);if(linked)db.prepare('UPDATE account_contacts SET linked=?,version=?,updated=? WHERE owner=? AND id=?').run(linked,next(uid),Date.now(),uid,c.id);}
   const fresh=settings(uid);respond(res,200,{version:fresh.version,epoch:config.epoch,enabled:!!config.enabled,discovery:config.discovery,presence:config.presence,contacts:entries(uid,since)});return true;
  }
  if(path==='/api/contacts/settings'&&method==='POST'){
   const data=await body(req);if(data.discovery!==undefined&&!['everyone','contacts','nobody'].includes(data.discovery))throw fail(400,'Некорректная приватность');if(data.presence!==undefined&&!['everyone','contacts','nobody'].includes(data.presence))throw fail(400,'Некорректная приватность присутствия');if(data.enabled!==undefined&&typeof data.enabled!=='boolean')throw fail(400,'Некорректная настройка синхронизации');
   if((data.enabled===undefined||Number(data.enabled)===config.enabled)&&(data.discovery===undefined||data.discovery===config.discovery)&&(data.presence===undefined||data.presence===config.presence)){respond(res,200,config);return true;}
   db.prepare('UPDATE contact_settings SET enabled=?,discovery=?,presence=? WHERE owner=?').run(data.enabled===undefined?config.enabled:Number(data.enabled),data.discovery??config.discovery,data.presence??config.presence,uid);next(uid);changed(uid);respond(res,200,settings(uid));return true;
  }
  if(path==='/api/contacts/sync'&&method==='POST'){
   rate(uid,'sync',120);const data=await body(req),dev=device(data.device_id);
   if(!config.enabled||data.epoch!==config.epoch)throw fail(409,'Синхронизация выключена или телефонная книга удалена. Включите её заново');
   if(data.base_version!==config.version)throw fail(409,'Контакты изменились на другом устройстве. Обновите список');
   if(!Array.isArray(data.contacts)||data.contacts.length>40||!Array.isArray(data.removed)||data.removed.length>100)throw fail(400,'Некорректный пакет контактов');
   const rows=data.contacts.map(c=>{if(!c||typeof c.source_id!=='string'||c.source_id.length>100||!c.source_id)throw fail(400,'Некорректный источник контакта');return {...c,phone_numbers:phones(c.phone_numbers)};});
   if(data.removed.some(x=>typeof x!=='string'||x.length>100))throw fail(400,'Некорректные удалённые контакты');
   if(!db.prepare('SELECT 1 FROM contact_devices WHERE owner=? AND device=?').get(uid,dev)&&db.prepare('SELECT COUNT(*) AS n FROM contact_devices WHERE owner=?').get(uid).n>=20)throw fail(429,'Лимит устройств синхронизации: 20');
   budget(uid,rows.flatMap(x=>x.phone_numbers));
   db.exec('BEGIN IMMEDIATE');try{
    for(const c of rows){const key=fingerprint(JSON.stringify([cleanName(c.phonebook_name),c.phone_numbers]));const source=db.prepare('SELECT * FROM contact_sources WHERE owner=? AND device=? AND source=?').get(uid,dev,c.source_id);if(source?.fingerprint===key)continue;
     let id=source?.contact_id;
     if(id){const record=db.prepare('SELECT * FROM account_contacts WHERE owner=? AND id=?').get(uid,id);if(record?.deleted)continue;
      if(record){const linked=record.linked||c.phone_numbers.map(p=>discover(uid,p)).find(Boolean)||null;db.prepare('UPDATE account_contacts SET phones=?,phonebook_name=?,linked=?,version=?,updated=? WHERE owner=? AND id=?').run(JSON.stringify(c.phone_numbers),cleanName(c.phonebook_name),linked,next(uid),Date.now(),uid,id);}
     }else id=upsert(uid,c);
     if(id)db.prepare('INSERT INTO contact_sources(owner,device,source,contact_id,fingerprint,data) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,device,source) DO UPDATE SET contact_id=excluded.contact_id,fingerprint=excluded.fingerprint,data=excluded.data').run(uid,dev,c.source_id,id,key,JSON.stringify({phone_numbers:c.phone_numbers,phonebook_name:cleanName(c.phonebook_name)}));
     if(id)mergeSources(uid,id);
    }
    for(const source of data.removed){const row=db.prepare('SELECT contact_id FROM contact_sources WHERE owner=? AND device=? AND source=?').get(uid,dev,source);if(!row)continue;db.prepare('DELETE FROM contact_sources WHERE owner=? AND device=? AND source=?').run(uid,dev,source);mergeSources(uid,row.contact_id);
     if(!db.prepare('SELECT 1 FROM contact_sources WHERE owner=? AND contact_id=?').get(uid,row.contact_id)){const c=db.prepare('SELECT * FROM account_contacts WHERE owner=? AND id=?').get(uid,row.contact_id);if(c&&!c.manual)db.prepare("UPDATE account_contacts SET phones='[]',phonebook_name='',deleted=?,version=?,updated=? WHERE owner=? AND id=?").run(c.custom_name?0:1,next(uid),Date.now(),uid,c.id);}
    }
    if(db.prepare('SELECT COUNT(*) AS n FROM account_contacts WHERE owner=? AND deleted=0').get(uid).n>5000)throw fail(413,'В телефонной книге можно синхронизировать до 5000 контактов');
    db.prepare('INSERT INTO contact_devices VALUES(?,?,?,?) ON CONFLICT(owner,device) DO UPDATE SET version=excluded.version,updated=excluded.updated').run(uid,dev,settings(uid).version,Date.now());db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   changed(uid);respond(res,200,{version:settings(uid).version,epoch:config.epoch});return true;
  }
  if(path==='/api/contacts/link'&&method==='POST'){rate(uid,'manual',10);const data=await body(req),target=Number(data.user_id);if(!Number.isSafeInteger(target)||target===uid||!userById(target))throw fail(404,'Пользователь не найден');let c=db.prepare('SELECT id FROM account_contacts WHERE owner=? AND linked=? AND deleted=0').get(uid,target);if(!c){const id=randomUUID();db.prepare('INSERT INTO account_contacts(owner,id,linked,manual,version,updated) VALUES(?,?,?,1,?,?)').run(uid,id,target,next(uid),Date.now());c={id};changed(uid);}respond(res,200,entries(uid).find(x=>x.contact_id===c.id));return true;}
  if(path==='/api/contacts/manual'&&method==='POST'){rate(uid,'manual',10);const data=await body(req);budget(uid,phones(data.phone_numbers));if(data.imported===true&&(!config.enabled||data.epoch!==config.epoch))throw fail(409,'Сначала включите синхронизацию');const id=upsert(uid,data,data.imported!==true);changed(uid);respond(res,200,entries(uid).find(x=>x.contact_id===id));return true;}
  if(path==='/api/contacts/purge'&&method==='POST'){
   const data=await body(req);if(data.confirm!==true)throw fail(400,'Подтвердите удаление');db.exec('BEGIN IMMEDIATE');try{
    const v=next(uid);db.prepare("UPDATE account_contacts SET phones=CASE WHEN manual=1 THEN phones ELSE '[]' END,phonebook_name=CASE WHEN manual=1 THEN phonebook_name ELSE '' END,deleted=CASE WHEN manual=1 OR custom_name!='' THEN 0 ELSE 1 END,version=?,updated=? WHERE owner=?").run(v,Date.now(),uid);
    db.prepare('DELETE FROM contact_sources WHERE owner=?').run(uid);db.prepare('DELETE FROM contact_devices WHERE owner=?').run(uid);db.prepare('DELETE FROM contact_queries WHERE owner=?').run(uid);db.prepare('UPDATE contact_settings SET enabled=0,epoch=epoch+1 WHERE owner=?').run(uid);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}changed(uid);respond(res,200,settings(uid));return true;
  }
  const edit=path.match(/^\/api\/contacts\/([a-f0-9-]{36})\/(name|delete)$/);
  if(edit&&method==='POST'){const data=await body(req),c=db.prepare('SELECT * FROM account_contacts WHERE owner=? AND id=? AND deleted=0').get(uid,edit[1]);if(!c)throw fail(404,'Контакт не найден');if(edit[2]==='name'&&cleanName(data.custom_name)===c.custom_name){respond(res,200,entries(uid).find(x=>x.contact_id===c.id));return true;}if(data.version!==c.version)throw fail(409,'Контакт изменён на другом устройстве. Обновите его');
   db.prepare('UPDATE account_contacts SET custom_name=?,deleted=?,version=?,updated=? WHERE owner=? AND id=?').run(edit[2]==='name'?cleanName(data.custom_name):c.custom_name,edit[2]==='delete'?1:0,next(uid),Date.now(),uid,c.id);changed(uid);respond(res,200,entries(uid).find(x=>x.contact_id===c.id));return true;}
  return false;
 }
 const retention=setInterval(()=>{db.prepare('DELETE FROM contact_operations WHERE created<?').run(Date.now()-7*86400000);db.prepare('DELETE FROM contact_queries WHERE created<?').run(Date.now()-86400000);db.prepare('DELETE FROM contact_devices WHERE updated<?').run(Date.now()-180*86400000);},3600000);retention.unref();
 return {handle,personalize,discover,display,close:()=>clearInterval(retention)};
}
