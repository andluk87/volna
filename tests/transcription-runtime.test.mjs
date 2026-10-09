import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('Whisper loads in background, retries after failure and shuts down without waiting for a retry',()=>{
  const result=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','transcription_runtime_test.py'],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
