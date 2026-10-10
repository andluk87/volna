export const ADMIN_PHONE='+79681411241';
export const defaultAdminSettings=Object.freeze({registration_enabled:true,maintenance:false,maintenance_message:'Волна временно на обслуживании. Попробуйте позже.',upload_max_mb:20,user_storage_mb:200,sms_phone_hour:5,sms_ip_hour:20,sms_day:300,sms_provider:process.env.SMS_PROVIDER||'notificore'});
export function initAdminSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS admin_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sms(id TEXT PRIMARY KEY,phone TEXT NOT NULL,code_hash TEXT NOT NULL,reference TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ip TEXT NOT NULL,provider_id TEXT);
 CREATE INDEX IF NOT EXISTS admin_sms_created ON admin_sms(created);
 CREATE TABLE IF NOT EXISTS admin_sessions(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,last_seen INTEGER NOT NULL,agent TEXT NOT NULL,ip TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,details TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_backups(id TEXT PRIMARY KEY,filename TEXT NOT NULL,created INTEGER NOT NULL,size INTEGER NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(admin_sms)').all().some(c=>c.name==='provider'))db.exec("ALTER TABLE admin_sms ADD COLUMN provider TEXT NOT NULL DEFAULT 'notificore'");
 for(const [table,columns] of Object.entries({users:{admin_blocked:'INTEGER NOT NULL DEFAULT 0',admin_reason:"TEXT NOT NULL DEFAULT ''"},chats:{admin_locked:'INTEGER NOT NULL DEFAULT 0',admin_deleted:'INTEGER NOT NULL DEFAULT 0'},attachments:{admin_blocked:'INTEGER NOT NULL DEFAULT 0'}})){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const present=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
  for(const [name,type] of Object.entries(columns))if(!present.has(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
 }
}
export function readAdminSettings(db){const row=db.prepare('SELECT value FROM admin_config WHERE id=1').get();return {...defaultAdminSettings,...(row?JSON.parse(row.value):{})};}
export function validateAdminSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(Error('Некорректные настройки'),{status:400});
 const out={};for(const [key,initial] of Object.entries(defaultAdminSettings)){
  const v=value[key];if(typeof initial==='boolean'){if(typeof v!=='boolean')throw Object.assign(Error('Некорректный переключатель '+key),{status:400});}
  else if(key==='sms_provider'){if(!['notificore','gateway'].includes(v))throw Object.assign(Error('Выберите Notificore или SMS-шлюз'),{status:400});}
  else if(typeof initial==='string'){if(typeof v!=='string'||!v.trim()||v.length>300)throw Object.assign(Error('Текст обслуживания: от 1 до 300 символов'),{status:400});}
  else{const ranges={upload_max_mb:[1,20],user_storage_mb:[20,5000],sms_phone_hour:[1,20],sms_ip_hour:[1,100],sms_day:[1,3000]};const [min,max]=ranges[key];if(!Number.isSafeInteger(v)||v<min||v>max)throw Object.assign(Error(`${key}: число от ${min} до ${max}`),{status:400});}
  out[key]=typeof v==='string'?v.trim():v;
 }if(out.user_storage_mb<out.upload_max_mb)throw Object.assign(Error('Квота пользователя должна быть не меньше размера файла'),{status:400});return out;
}
