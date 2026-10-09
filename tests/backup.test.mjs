import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('backup uses the same HTTPS Compose files and profile as deployment',()=>{
 const root=mkdtempSync(join(tmpdir(),'volna-backup-'));
 try{
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'bin'));
  copyFileSync(new URL('../scripts/backup.sh',import.meta.url),join(root,'scripts/backup.sh'));
  writeFileSync(join(root,'compose.yaml'),'services: {}\n');writeFileSync(join(root,'compose.https.yaml'),'services: {}\n');
  writeFileSync(join(root,'.env'),'CHAT_DOMAIN=volna.example\n');
  const trace=join(root,'trace');
  writeFileSync(join(root,'bin/docker'),'#!/bin/sh\necho "$*" >> "$TRACE"\ncase "$*" in *"ps --status running -q server"*) if [ "$SERVER_STOPPED" != 1 ]; then echo old-server-container; fi;; *" run "*) if [ "$FAIL_BACKUP" = 1 ]; then exit 8; fi; echo archive-bytes;; esac\n',{mode:0o755});
  const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,TRACE:trace,FAIL_BACKUP:'0'};
  const result=spawnSync('sh',['scripts/backup.sh'],{cwd:root,env});
  assert.equal(result.status,0,result.stderr?.toString());
  const commands=readFileSync(trace,'utf8').trim().split('\n');
  assert.equal(commands.length,5);
  for(const command of commands.slice(0,-1))assert.match(command,/-f compose\.yaml -f compose\.https\.yaml --profile calls/);
  assert.equal(commands.at(-1),'start old-server-container');
  assert.doesNotMatch(commands.join('\n'),/up -d/,'backup never recreates containers or waits for model downloads');
  assert.ok(readdirSync(join(root,'backups')).some(name=>name.endsWith('.tar.gz')));
  writeFileSync(trace,'');
  const failure=spawnSync('sh',['scripts/backup.sh'],{cwd:root,env:{...env,FAIL_BACKUP:'1'}});
  assert.notEqual(failure.status,0);assert.match(failure.stderr.toString(),/Backup failed/);
  assert.equal(readFileSync(trace,'utf8').trim().split('\n').at(-1),'start old-server-container','failed backup restores the existing server too');
  assert.ok(!readdirSync(join(root,'backups')).some(name=>name.endsWith('.tmp')));
  writeFileSync(trace,'');
  const stopped=spawnSync('sh',['scripts/backup.sh'],{cwd:root,env:{...env,SERVER_STOPPED:'1'}});
  assert.equal(stopped.status,0);assert.doesNotMatch(readFileSync(trace,'utf8'),/^start /m,'backup preserves a deliberately stopped server');
 }finally{rmSync(root,{recursive:true,force:true});}
});
