// Explicit deployment step: the server never wipes an old database on startup.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,renameSync,chmodSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const database=process.env.DB_PATH||'/data/volna.db';
if(process.argv[2]!=='--reset-legacy')throw Error('Use --reset-legacy only after scripts/backup.sh; stop every server instance first.');
if(!existsSync(database)){console.log('No previous database. Ready for phone authentication.');process.exit(0);}
const db=new DatabaseSync(database);
const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
if(exists&&db.prepare('PRAGMA table_info(users)').all().some(x=>x.name==='phone')){db.close();console.log('Phone database already active: reset skipped.');process.exit(0);}
const folder=join(dirname(database),'legacy-auth-backups',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(folder,{recursive:true,mode:0o700});
// A consistent standalone SQLite snapshot must succeed before anything is removed.
const snapshot=join(folder,'legacy.db');
db.exec(`VACUUM INTO '${snapshot.replaceAll("'","''")}'`);chmodSync(snapshot,0o600);
const check=new DatabaseSync(snapshot,{readOnly:true});
if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed. Original database retained.');
check.close();db.close();
renameSync(database,join(folder,'original.db'));chmodSync(join(folder,'original.db'),0o600);
for(const suffix of ['-wal','-shm'])if(existsSync(database+suffix))renameSync(database+suffix,join(folder,'original.db'+suffix));
const uploads=process.env.UPLOAD_PATH||join(dirname(database),'uploads');
if(existsSync(uploads))renameSync(uploads,join(folder,'uploads'));
writeFileSync(join(folder,'README.txt'),'Administrative backup only. Do not restore into the new phone authentication system. Old users, credentials, sessions, chats and media are excluded from the new active database.\n',{mode:0o600});
console.log('Legacy account database and uploads removed from active service. Technical backup:',folder);
