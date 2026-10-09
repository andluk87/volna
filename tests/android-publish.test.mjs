import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Android build can configure TURN once, preserve credentials, and publish the same APK version without a second build',()=>{
  const root=mkdtempSync(join(tmpdir(),'volna-publish-'));
  try{
    for(const directory of ['scripts','bin','android-native/app'])mkdirSync(join(root,directory),{recursive:true});
    for(const name of ['build-android.sh','configure-calls.py'])copyFileSync(new URL('../scripts/'+name,import.meta.url),join(root,'scripts',name));
    copyFileSync(new URL('../android-native/app/build.gradle.kts',import.meta.url),join(root,'android-native/app/build.gradle.kts'));
    const secret='ab'.repeat(32),telegram='telegram-secret-fixture';
    writeFileSync(join(root,'.env'),`CHAT_DOMAIN=volna.example.com\nTURN_EXTERNAL_IP=8.8.8.8\nTURN_SECRET=${secret}\nTELEGRAM_CLIENT_SECRET=${telegram}\nANDROID_BUILD_OFFLINE=auto\n`);
    writeFileSync(join(root,'compose.yaml'),'services: {}\n');
    copyFileSync(new URL('../compose.build-host.yaml',import.meta.url),join(root,'compose.build-host.yaml'));
    writeFileSync(join(root,'scripts/update.sh'),'#!/bin/sh\nprintf "UPDATE\\nNETWORK=%s\\n" "${VOLNA_BUILD_NETWORK:-default}" >> "$TRACE"\n');
    writeFileSync(join(root,'bin/docker'),`#!/usr/bin/env python3
import os,sys,zipfile
with open(os.environ['TRACE'],'a') as trace:trace.write(' '.join(sys.argv[1:])+'\\n')
if 'run' in sys.argv and 'android-builder' in sys.argv:
    with zipfile.ZipFile('artifacts/Volna-debug.apk','w') as archive:archive.writestr('AndroidManifest.xml','fixture, not a compiled APK')
`,{mode:0o755});
    writeFileSync(join(root,'bin/ufw'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    const trace=join(root,'trace');writeFileSync(trace,'');
    const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,TRACE:trace};
    const run=spawnSync('sh',['scripts/build-android.sh','--enable-calls'],{cwd:root,encoding:'utf8',env});assert.equal(run.status,0,run.stderr);
    const config=readFileSync(join(root,'.env'),'utf8');assert.match(config,/TURN_HOST=volna.example.com/);assert.ok(config.includes('TURN_SECRET='+secret));assert.ok(config.includes('TELEGRAM_CLIENT_SECRET='+telegram));assert.match(config,/ANDROID_BUILD_OFFLINE=auto/);assert.equal((run.stdout+run.stderr).includes(secret),false);
    const log=readFileSync(trace,'utf8');assert.equal((log.match(/run --build --rm android-builder/g)||[]).length,1);assert.equal((log.match(/UPDATE/g)||[]).length,1);
    const manifest=JSON.parse(readFileSync(join(root,'client/public/download/volna-android-version.json'),'utf8'));
    const gradle=readFileSync(join(root,'android-native/app/build.gradle.kts'),'utf8');assert.equal(manifest.version_name,gradle.match(/volnaVersionName = "([^"]+)"/)[1]);assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
    assert.deepEqual(readFileSync(join(root,'client/public/download/volna-android.apk')),readFileSync(join(root,'artifacts/Volna-debug.apk')));
    writeFileSync(trace,'');const invalid=spawnSync('sh',['scripts/build-android.sh','--unknown'],{cwd:root,encoding:'utf8',env});assert.notEqual(invalid.status,0);assert.equal(readFileSync(trace,'utf8'),'');
    const host=spawnSync('sh',['scripts/build-android.sh'],{cwd:root,encoding:'utf8',env:{...env,VOLNA_BUILD_NETWORK:'host'}});assert.equal(host.status,0,host.stderr);
    const hostLog=readFileSync(trace,'utf8');assert.match(hostLog,/compose -f compose.yaml -f compose.build-host.yaml --profile build run --build --rm android-builder/);assert.match(hostLog,/NETWORK=host/);assert.equal(readFileSync(join(root,'.env'),'utf8'),config);
    writeFileSync(trace,'');const badNetwork=spawnSync('sh',['scripts/build-android.sh'],{cwd:root,encoding:'utf8',env:{...env,VOLNA_BUILD_NETWORK:'wrong'}});assert.notEqual(badNetwork.status,0);assert.equal(readFileSync(trace,'utf8'),'');
  }finally{rmSync(root,{recursive:true,force:true});}
});
