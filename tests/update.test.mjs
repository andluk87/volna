import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('update rebuilds and verifies the selected Volna version; aborts before restart when build or backup fails',()=>{
 const root=mkdtempSync(join(tmpdir(),'volna-update-'));
 try{
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'bin'));
  copyFileSync(new URL('../scripts/update.sh',import.meta.url),join(root,'scripts/update.sh'));
  copyFileSync(new URL('../scripts/calls-config.py',import.meta.url),join(root,'scripts/calls-config.py'));
  for(const f of ['compose.yaml','compose.https.yaml'])writeFileSync(join(root,f),'services: {}\n');
  copyFileSync(new URL('../compose.build-host.yaml',import.meta.url),join(root,'compose.build-host.yaml'));
  writeFileSync(join(root,'package.json'),'{\n  "version": "0.11.14"\n}\n');
  writeFileSync(join(root,'.env'),'CHAT_DOMAIN=volna.lknet.ru\n');
  writeFileSync(join(root,'scripts/backup.sh'),'#!/bin/sh\necho BACKUP >> "$TRACE"\nexit "${FAIL_BACKUP:-0}"\n');
  writeFileSync(join(root,'bin/docker'),`#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['TRACE'],'a') as trace:trace.write(' '.join(args)+'\\n')
if 'build' in args:sys.exit(int(os.environ.get('FAIL_BUILD','0')))
if 'up' in args:sys.exit(int(os.environ.get('FAIL_UP','0')))
if '--format' in args and args[args.index('--format')+1]=='json':
    enabled=os.environ.get('TEST_CALLS')=='1'
    print(json.dumps({'services':{'server':{'environment':{'TURN_HOST':'turn.example' if enabled else '', 'TURN_SECRET':'a'*64 if enabled else ''}}}}))
elif 'inspect' in args:print('running 0' if any('State.Status' in value for value in args) else '0')
elif 'ps' in args and '-q' in args:print('turn-fixture')
`,{mode:0o755});
  writeFileSync(join(root,'bin/sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const trace=join(root,'trace');
  function run(extra={}){writeFileSync(trace,'');const result=spawnSync('sh',['scripts/update.sh'],{cwd:root,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,TRACE:trace,...extra}});return {status:result.status,log:readFileSync(trace,'utf8')};}
  const ok=run();assert.equal(ok.status,0);assert.match(ok.log,/-f compose.yaml -f compose.https.yaml/);assert.match(ok.log,/build server web transcription/);assert.match(ok.log,/up -d --wait --wait-timeout 600 server web transcription gateway/);assert.match(ok.log,/exec -T web sh -ec/);assert.ok(ok.log.indexOf('BACKUP')<ok.log.indexOf('up -d'));
  const configured=run({TEST_CALLS:'1'});assert.equal(configured.status,0);assert.match(configured.log,/up -d --wait --wait-timeout 600 server web transcription turn gateway/,'resolved container environment, including exported values, determines TURN startup');
  for(const env of [{FAIL_BUILD:'1'},{FAIL_BACKUP:'1'}]){const fail=run(env);assert.notEqual(fail.status,0);assert.doesNotMatch(fail.log,/up -d/);}
  const failedUp=run({FAIL_UP:'1'});assert.notEqual(failedUp.status,0);assert.match(failedUp.log,/logs --no-color --tail=80 transcription/);
  const host=run({VOLNA_BUILD_NETWORK:'host'});assert.equal(host.status,0);assert.match(host.log,/-f compose.yaml -f compose.https.yaml -f compose.build-host.yaml --profile calls build/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
