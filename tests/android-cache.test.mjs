import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Android builder reuses SDK, tries cached dependencies, and only retries missing packages online',()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-android-cache-'));
 try{
  const sdk=join(dir,'sdk'),bin=join(dir,'bin'),log=join(dir,'commands');mkdirSync(bin,{recursive:true});
  function file(path,text='cached',mode=0o644){mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,text,{mode});}
  for(const path of ['platforms/android-36/android.jar','licenses/android-sdk-license'])file(join(sdk,path));
  for(const path of ['cmdline-tools/latest/bin/sdkmanager','platform-tools/adb'])file(join(sdk,path),'#!/bin/sh\necho forbidden-sdk-network >&2\nexit 99\n',0o755);
  const source=readFileSync('android-native/app/build.gradle.kts','utf8');
  const versionName=source.match(/volnaVersionName\s*=\s*"([^"]+)"/)[1],versionCode=Number(source.match(/volnaVersionCode\s*=\s*([0-9_]+)/)[1].replaceAll('_',''));
  file(join(dir,'app/build.gradle.kts'),source);
  file(join(dir,'scripts/check-apk-version.py'),readFileSync('android-native/scripts/check-apk-version.py','utf8'));
  file(join(dir,'scripts/sms-app-hash.py'),readFileSync('android-native/scripts/sms-app-hash.py','utf8'));
  file(join(sdk,'build-tools/36.0.0/apksigner'),`#!/bin/sh
if [ "$TEST_RESULT" = bad-signature ]; then exit 1; fi
printf '%s\\n' '-----BEGIN CERTIFICATE-----' 'AQID' '-----END CERTIFICATE-----'
`,0o755);
  file(join(sdk,'build-tools/36.0.0/aapt2'),`#!/bin/sh
test "$1" = dump && test -s "$3" || exit 90
if [ "$2" = badging ]; then
 case "$TEST_RESULT" in
  badging-error) echo 'cannot read badging' >&2; exit 3;;
  stale-apk) printf "package: name='dev.volna.messenger' versionCode='11000' versionName='0.11.0'\\n";;
  wrong-package) printf "package: name='another.application' versionCode='${versionCode}' versionName='${versionName}'\\n";;
  *) printf "package: name='dev.volna.messenger' versionCode='${versionCode}' versionName='${versionName}'\\n";;
 esac
 exit 0
fi
test "$2" = permissions || exit 90
case "$TEST_RESULT" in
 apk-error) echo 'cannot read compiled AndroidManifest.xml' >&2; exit 3;;
 no-network) printf "uses-permission: name='android.permission.INTERNET'\\n";;
 no-internet) printf "uses-permission: name='android.permission.ACCESS_NETWORK_STATE'\\n";;
 declared-only) printf "uses-permission: name='android.permission.INTERNET'\\npermission: name='android.permission.ACCESS_NETWORK_STATE'\\n";;
 network-prefix) printf "uses-permission: name='android.permission.INTERNET'\\nuses-permission: name='android.permission.ACCESS_NETWORK_STATE_FAKE'\\n";;
 no-full-screen) printf "uses-permission: name='android.permission.INTERNET'\\nuses-permission: name='android.permission.ACCESS_NETWORK_STATE'\\n";;
 *) printf "uses-permission: name='android.permission.INTERNET'\\nuses-permission: name='android.permission.ACCESS_NETWORK_STATE'\\nuses-permission: name='android.permission.USE_FULL_SCREEN_INTENT'\\n";;
esac
`,0o755);
  file(join(dir,'scripts/prepare-expressions.py'),'# Asset bundling is tested by expressions_assets_test.py.\n');
  file(join(bin,'unzip'),`#!/bin/sh
if [ "$TEST_RESULT" = no-emoji ]; then echo AndroidManifest.xml; else printf 'assets/emoji/NotoColorEmoji.ttf\\nassets/emoji/catalog.json\\n'; fi
`,0o755);
  file(join(bin,'curl'),'#!/bin/sh\necho forbidden-download >&2\nexit 99\n',0o755);
  file(join(bin,'gradle'),`#!/bin/sh
echo "$*" >> "$TEST_COMMANDS"
case "$TEST_RESULT:$*" in
 missing:*--offline*) echo 'No cached version of a dependency available for offline mode'; exit 1;;
 plugin:*--offline*) echo "Plugin [id: 'com.android.application', version: '8.10.1', apply: false] was not found in any of the following sources:"; echo "could not resolve plugin artifact 'com.android.application:com.android.application.gradle.plugin:8.10.1'"; exit 1;;
 plugin-unavailable:*) echo "Plugin [id: 'com.android.application', version: '8.10.1', apply: false] was not found in any of the following sources:"; exit 1;;
 compile:*) echo 'Argument type mismatch: actual type is String, Context was expected'; exit 1;;
 unit:*) echo 'There were failing tests. Native crash trace fixture failed.'; exit 1;;
esac
mkdir -p app/build/outputs/apk/debug
printf 'apk-fixture' > app/build/outputs/apk/debug/app-debug.apk
`,0o755);
  const script=resolve('client/scripts/docker-android-build.sh');
  function run(mode,result){writeFileSync(log,'');return spawnSync('sh',[script],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,ANDROID_HOME:sdk,ANDROID_BUILD_OFFLINE:mode,ANDROID_DOWNLOAD_CACHE:join(dir,'downloads'),ANDROID_OUTPUT_DIR:join(dir,'out'),TMPDIR:join(dir,'tmp'),TEST_RESULT:result,TEST_COMMANDS:log}});}
  let result=run('auto','cached');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/no SDK Manager network request/);assert.match(result.stdout,/completed offline/);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.match(readFileSync(log,'utf8'),/--offline/);assert.equal(readFileSync(join(dir,'out/Volna-debug.apk'),'utf8'),'apk-fixture');
  assert.match(readFileSync(join(dir,'out/Volna-sms-app-hash.txt'),'utf8'),/^[A-Za-z0-9+/]{11}\n$/);
  assert.match(readFileSync(log,'utf8'),/:app:testDebugUnitTest :app:assembleDebug/);
  result=run('auto','missing');assert.equal(result.status,0,result.stderr);let commands=readFileSync(log,'utf8').trim().split('\n');assert.equal(commands.length,2);assert.match(commands[0],/--offline/);assert.doesNotMatch(commands[1],/--offline/);
  result=run('auto','plugin');assert.equal(result.status,0,result.stderr);commands=readFileSync(log,'utf8').trim().split('\n');assert.equal(commands.length,2);assert.match(commands[0],/--offline/);assert.doesNotMatch(commands[1],/--offline/);assert.match(result.stdout,/including Gradle plugin resolution/);
  result=run('auto','plugin-unavailable');assert.equal(result.status,1);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,2);
  result=run('1','plugin');assert.equal(result.status,1);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.match(result.stderr,/Strict offline mode/);
  result=run('auto','compile');assert.equal(result.status,1);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.match(result.stderr,/Argument type mismatch/);
  rmSync(join(dir,'out'),{recursive:true,force:true});result=run('auto','unit');assert.equal(result.status,1);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.match(result.stderr,/There were failing tests/);assert.throws(()=>readFileSync(join(dir,'out/Volna-debug.apk')));
  result=run('1','missing');assert.equal(result.status,1);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);
  result=run('0','cached');assert.equal(result.status,0);assert.doesNotMatch(readFileSync(log,'utf8'),/--offline/);
  assert.match(result.stdout,/Verified Android network permissions in compiled APK/);
  assert.match(result.stdout,/Verified compiled Android version: Volna/);
  for(const failure of ['no-network','no-internet','declared-only','network-prefix','no-full-screen','apk-error','no-emoji','stale-apk','wrong-package','badging-error','bad-signature']){
    rmSync(join(dir,'out'),{recursive:true,force:true});result=run('auto',failure);assert.notEqual(result.status,0,failure);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,1);assert.throws(()=>readFileSync(join(dir,'out/Volna-debug.apk')));
    if(['no-network','no-internet','declared-only','network-prefix','no-full-screen'].includes(failure))assert.match(result.stderr,/missing required permission/);
    if(['stale-apk','wrong-package'].includes(failure))assert.match(result.stderr,/does not match the sources/);
  }
  rmSync(join(sdk,'platforms'),{recursive:true});result=run('1','cached');assert.equal(result.status,1);assert.match(result.stderr,/SDK packages are not cached/);assert.equal(readFileSync(log,'utf8'),'');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
