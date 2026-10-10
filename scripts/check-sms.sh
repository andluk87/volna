#!/bin/sh
# Read-only SMS diagnostics; no phone numbers, codes or API keys are printed.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T server node --input-type=module <<'JS'
import {DatabaseSync} from 'node:sqlite';
import {createSmsRouter} from './server/sms-providers.mjs';
console.log({key_configured:!!process.env.NOTIFICORE_API_KEY?.trim(),sender_configured:!!process.env.NOTIFICORE_ORIGINATOR?.trim(),trust_proxy:process.env.AUTH_TRUST_PROXY==='1'});
const db=new DatabaseSync(process.env.DB_PATH||'/data/volna.db',{readOnly:true});
try {
 const now=Date.now();console.log(createSmsRouter({db}).status());
 console.table(db.prepare('SELECT status,COUNT(*) AS count FROM sms_challenges WHERE created>? GROUP BY status').all(now-86400000));
 console.table(db.prepare('SELECT reference,provider,status,provider_id,length(provider_id)>0 AS provider_accepted FROM sms_challenges ORDER BY created DESC LIMIT 10').all());
 console.table(db.prepare('SELECT reference,provider,status,provider_id,length(provider_id)>0 AS provider_accepted FROM admin_sms ORDER BY created DESC LIMIT 10').all());
 console.log({requests_last_day:db.prepare('SELECT COUNT(*) n FROM sms_challenges WHERE created>?').get(now-86400000).n,largest_ip_bucket_last_hour:db.prepare('SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM sms_challenges WHERE created>? GROUP BY ip)').get(now-3600000).n||0});
} finally {db.close();}
JS
