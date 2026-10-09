import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Windows low-space preflight stops before pulling or running a builder and preserves files', () => {
  const root = mkdtempSync(join(tmpdir(), 'volna-space-'));
  try {
    for (const dir of ['scripts','bin','client/public/download']) mkdirSync(join(root,dir),{recursive:true});
    for (const file of ['build-windows.sh','check-windows-space.py']) copyFileSync('scripts/'+file,join(root,'scripts',file));
    writeFileSync(join(root,'.env'),'KEEP=secret\n');
    writeFileSync(join(root,'compose.yaml'),'services: {}\n');
    writeFileSync(join(root,'client/public/download/volna-windows.exe'),'previous installer');
    const log=join(root,'calls');
    writeFileSync(join(root,'bin/docker'),'#!/bin/sh\necho "$*" >> "$TEST_LOG"\nif [ "$1" = info ]; then printf "%s\\n" "$TEST_ROOT"; fi\n',{mode:0o755});
    const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,TEST_LOG:log,TEST_ROOT:root,WINDOWS_BUILD_MIN_FREE_MB:'2147483647'};
    const result=spawnSync('sh',['scripts/build-windows.sh'],{cwd:root,env,encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Insufficient free disk space/);
    assert.match(result.stderr,/Nothing was deleted/);
    assert.doesNotMatch(readFileSync(log,'utf8'),/compose|prune|run|build/);
    assert.equal(readFileSync(join(root,'.env'),'utf8'),'KEEP=secret\n');
    assert.equal(readFileSync(join(root,'client/public/download/volna-windows.exe'),'utf8'),'previous installer');
    const invalid=spawnSync('python3',['scripts/check-windows-space.py'],{cwd:root,env:{...env,WINDOWS_BUILD_MIN_FREE_MB:'invalid'},encoding:'utf8'});
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/must be an integer/);
    assert.equal(readFileSync(log,'utf8').trim(),'info --format {{.DockerRootDir}}');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
