const {execFile}=require('node:child_process');
let pending,last=0,cached=null;
function systemFocusState(platform=process.platform){
 if(platform!=='win32')return Promise.resolve(null);if(Date.now()-last<5000)return Promise.resolve(cached);if(pending)return pending;
 const script="Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class VLNNotificationState { [DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int state); }'; $state=0; $result=[VLNNotificationState]::SHQueryUserNotificationState([ref]$state); if($result -eq 0){[Console]::Write($state)}";
 pending=new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:3000,windowsHide:true},(error,stdout)=>{const state=Number(String(stdout).trim());cached=!error&&state>=1&&state<=7?state!==5:null;last=Date.now();pending=null;resolve(cached);}));return pending;
}
module.exports={systemFocusState};
