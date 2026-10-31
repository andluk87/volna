import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('offline model import preserves environment until model validation succeeds and backs it up privately',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-offline-asr-'));
 try{
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'bin'));mkdirSync(join(dir,'artifacts/gigaam-v3'),{recursive:true});
  copyFileSync(new URL('../scripts/import-asr-model.sh',import.meta.url),join(dir,'scripts/import-asr-model.sh'));
  const original='TURN_SECRET=keep-private\nASR_ENGINE=whisper\nWHISPER_LANGUAGE=auto\n';writeFileSync(join(dir,'.env'),original,{mode:0o600});
  writeFileSync(join(dir,'bin/docker'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\ncase "$*" in\n "compose ps -q transcription") echo fixture;;\n *load_gigaam*) [ "${FAIL_MODEL_CHECK:-0}" != 1 ];;\n *) exit 0;;\nesac\n',{mode:0o755});
  const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CALLS:join(dir,'calls')};
  const run=(extra={})=>spawnSync('sh',[join(dir,'scripts/import-asr-model.sh')],{env:{...env,...extra},encoding:'utf8'});
  assert.notEqual(run().status,0);assert.equal(readFileSync(join(dir,'.env'),'utf8'),original);
  for(const name of ['config.json','v3_e2e_rnnt_encoder.onnx','v3_e2e_rnnt_decoder.onnx','v3_e2e_rnnt_joint.onnx','v3_e2e_rnnt_vocab.txt'])writeFileSync(join(dir,'artifacts/gigaam-v3',name),name==='config.json'?'{"version":"v3"}':'fixture weights');
  assert.notEqual(run({FAIL_MODEL_CHECK:'1'}).status,0);assert.equal(readFileSync(join(dir,'.env'),'utf8'),original);
  const success=run();assert.equal(success.status,0,success.stderr);const changed=readFileSync(join(dir,'.env'),'utf8');assert.ok(changed.includes('TURN_SECRET=keep-private'));assert.ok(changed.includes('ASR_ENGINE=gigaam'));assert.ok(changed.includes('WHISPER_LANGUAGE=ru'));assert.match(changed,/GIGAAM_MODEL_DIR=\/models\/gigaam-v3-offline-/);assert.ok(changed.includes('WHISPER_FALLBACK_MODEL=off'));assert.ok(!success.stdout.includes('keep-private'));
  const backup=join(dir,'backups',readdirSync(join(dir,'backups'))[0]);assert.equal(readFileSync(backup,'utf8'),original);assert.equal(statSync(backup).mode&0o777,0o600);
  const calls=readFileSync(join(dir,'calls'),'utf8');assert.ok(calls.includes('compose cp artifacts/gigaam-v3/. transcription:/models/gigaam-v3-offline-'));assert.ok(calls.includes('compose up -d --no-deps transcription'));assert.ok(!calls.includes(' down'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
