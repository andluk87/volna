import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('PostgreSQL migration reloads nginx after API recreation and checks the client-facing proxy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-pg-proxy-'));
 try{
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'bin'));
  copyFileSync(new URL('../scripts/migrate-postgres.sh',import.meta.url),join(dir,'scripts/migrate-postgres.sh'));
  writeFileSync(join(dir,'scripts/backup.sh'),'#!/bin/sh\necho BACKUP >> "$TRACE"\n');
  writeFileSync(join(dir,'.env'),'POSTGRES_PASSWORD='+'a'.repeat(64)+'\nCHAT_DOMAIN=test.example\n');
  writeFileSync(join(dir,'compose.yaml'),'services: {}\n');
  writeFileSync(join(dir,'bin/docker'),'#!/bin/sh\necho "$*" >> "$TRACE"\ncase "$*" in *"ps --status running -q web"*) echo web-container;; *"exec -T web wget"*) exit "${FAIL_PROXY:-0}";; esac\n',{mode:0o755});
  writeFileSync(join(dir,'bin/sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const trace=join(dir,'trace'),env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,TRACE:trace};
  const run=extra=>spawnSync('sh',['scripts/migrate-postgres.sh'],{cwd:dir,env:{...env,...extra},encoding:'utf8'});
  const ok=run({});assert.equal(ok.status,0,ok.stderr);const log=readFileSync(trace,'utf8');
  const api=log.indexOf('up -d --no-deps --wait --wait-timeout 120 server'),reload=log.indexOf('exec -T web nginx -s reload'),health=log.indexOf('exec -T web wget');
  assert.ok(api>=0&&reload>api&&health>reload);assert.match(log,/-f compose.yaml -f compose.https.yaml/);
  writeFileSync(trace,'');const failed=run({FAIL_PROXY:'1'});assert.notEqual(failed.status,0);assert.match(failed.stderr,/do not repeat the database import/);
  assert.equal(readFileSync(trace,'utf8').split('\n').filter(line=>line.includes('scripts/migrate-postgres.mjs')).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
