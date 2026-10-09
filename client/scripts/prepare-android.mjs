import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const [major,minor,patch]=version.split('.').map(Number);
const versionCode=major*1000000+minor*1000+patch;
const appGradle='android/app/build.gradle';let gradle=readFileSync(appGradle,'utf8');
if(!/versionCode\s+\d+/.test(gradle)||!/versionName\s+['\"][^'\"]+['\"]/.test(gradle))throw Error('Android version fields are missing from app/build.gradle');
gradle=gradle.replace(/versionCode\s+\d+/,`versionCode ${versionCode}`).replace(/versionName\s+(['\"])[^'\"]+\1/,`versionName \"${version}\"`);writeFileSync(appGradle,gradle);
const path='android/app/src/main/AndroidManifest.xml';let text=readFileSync(path,'utf8');
for(const permission of ['RECORD_AUDIO','MODIFY_AUDIO_SETTINGS','BLUETOOTH_CONNECT','FOREGROUND_SERVICE','FOREGROUND_SERVICE_MICROPHONE','WAKE_LOCK'])if(!text.includes('android.permission.'+permission))text=text.replace('</manifest>',`    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
if(!text.includes('CallKeepAliveService'))text=text.replace('</application>',`    <service android:name=".CallKeepAliveService" android:exported="false" android:foregroundServiceType="microphone" />\n</application>`);
writeFileSync(path,text);
const folder='android/app/src/main/java/dev/volna/messenger';mkdirSync(folder,{recursive:true});copyFileSync('native/VolnaAudioPlugin.java',folder+'/VolnaAudioPlugin.java');copyFileSync('native/CallKeepAliveService.java',folder+'/CallKeepAliveService.java');
writeFileSync(folder+'/MainActivity.java',`package dev.volna.messenger;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState) {
  registerPlugin(VolnaAudioPlugin.class);
  super.onCreate(savedInstanceState);
 }
}
`);
console.log('Android microphone, call routing, and background-call service configured');
