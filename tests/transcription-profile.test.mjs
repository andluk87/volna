import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('Whisper quality migration upgrades old defaults, preserves custom choices and backs up the environment privately',()=>{
 const script=new URL('../scripts/improve-transcription.py',import.meta.url).pathname;
 for(const [source,expected] of [['TURN_SECRET=keep-me\nWHISPER_MODEL=base\nWHISPER_BEAM_SIZE=1\nWHISPER_LANGUAGE=auto\n',['WHISPER_MODEL=large-v3','WHISPER_BEAM_SIZE=10','WHISPER_COMPUTE_TYPE=float32','WHISPER_CPU_THREADS=8']],['WHISPER_MODEL=/models/custom\nWHISPER_BEAM_SIZE=3\nWHISPER_COMPUTE_TYPE=float32\nWHISPER_CPU_THREADS=16\n',['WHISPER_MODEL=/models/custom','WHISPER_BEAM_SIZE=3']]]){
  const dir=mkdtempSync(path.join(os.tmpdir(),'volna-whisper-profile-'));
  try{writeFileSync(path.join(dir,'.env'),source,{mode:0o600});const run=()=>spawnSync('python3',[script],{cwd:dir,encoding:'utf8'});const result=run();assert.equal(result.status,0,result.stderr);const changed=readFileSync(path.join(dir,'.env'),'utf8');for(const line of expected)assert.ok(changed.includes(line));if(source.includes('TURN_SECRET')){assert.ok(changed.includes('TURN_SECRET=keep-me'));assert.ok(changed.includes('WHISPER_LANGUAGE=auto'));assert.ok(changed.includes('ASR_ENGINE=whisper'));assert.ok(changed.includes('WHISPER_FALLBACK_MODEL=off'));const backup=path.join(dir,'backups',readdirSync(path.join(dir,'backups'))[0]);assert.equal(readFileSync(backup,'utf8'),source);assert.equal(statSync(backup).mode&0o777,0o600);assert.ok(!result.stdout.includes('keep-me'));}assert.equal(run().status,0);assert.equal(readFileSync(path.join(dir,'.env'),'utf8'),changed);}finally{rmSync(dir,{recursive:true,force:true});}
 }
});

test('Russian default profile selects GigaAM while explicit engines and foreign language choices are preserved',()=>{
 const script=new URL('../scripts/improve-transcription.py',import.meta.url).pathname;
 for(const [source,engine] of [['WHISPER_MODEL=large-v3\nWHISPER_LANGUAGE=ru\nWHISPER_FALLBACK_MODEL=base\n','gigaam'],['ASR_ENGINE=whisper\nWHISPER_MODEL=large-v3\n','whisper'],['WHISPER_MODEL=/models/custom\n','whisper']]){
  const dir=mkdtempSync(path.join(os.tmpdir(),'volna-asr-engine-'));
  try{writeFileSync(path.join(dir,'.env'),source);const result=spawnSync('python3',[script],{cwd:dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);const text=readFileSync(path.join(dir,'.env'),'utf8');assert.ok(text.includes('ASR_ENGINE='+engine));assert.ok(text.includes('ASR_CPU_THREADS=auto'));assert.ok(text.includes('WHISPER_FALLBACK_MODEL=off'));if(source.includes('/models/custom'))assert.ok(text.includes('WHISPER_MODEL=/models/custom'));}finally{rmSync(dir,{recursive:true,force:true});}
 }
});
