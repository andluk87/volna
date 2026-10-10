#!/bin/sh
# Change provider without sending an SMS, including when the administrator cannot log in.
set -eu
case "${1:-}" in notificore|gateway) ;; *) echo 'Usage: sh scripts/select-sms-provider.sh notificore|gateway' >&2; exit 1;; esac
test -f compose.yaml && test -f .env || { echo 'Run from the installed Volna directory.' >&2; exit 1; }
compose() {
 if grep -Eq '^[[:space:]]*CHAT_DOMAIN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
  docker compose -f compose.yaml -f compose.https.yaml "$@"
 else docker compose -f compose.yaml "$@"; fi
}
compose exec -T server node --input-type=module - "$1" <<'NODE'
import {DatabaseSync} from 'node:sqlite';
import {ADMIN_PHONE,readAdminSettings,validateAdminSettings} from './server/admin-config.mjs';
import {createSmsRouter} from './server/sms-providers.mjs';
const provider=process.argv[2],db=new DatabaseSync(process.env.DB_PATH||'/data/volna.db');
try{
 db.exec('PRAGMA busy_timeout=5000');
 const router=createSmsRouter({db});router.validatePhone(process.env.ADMIN_PHONE||ADMIN_PHONE,provider);
 if(!router.status().providers[provider]?.configured)throw Error('Provider is not configured. Set its credentials in .env and recreate the server container.');
 db.exec('BEGIN IMMEDIATE');
 const settings=validateAdminSettings({...readAdminSettings(db),sms_provider:provider});
 db.prepare('INSERT INTO admin_config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(settings));
 db.prepare('INSERT INTO admin_audit(created,actor,action,target,reason,details) VALUES(?,?,?,?,?,?)').run(Date.now(),'server-console','settings.sms_provider','system','Выбор через консоль сервера',JSON.stringify({provider}));
 db.exec('COMMIT');console.log('SMS provider selected: '+provider+'. No SMS was sent.');
}catch(e){try{db.exec('ROLLBACK');}catch{}console.error(e.message);process.exitCode=1;}finally{db.close();}
NODE
