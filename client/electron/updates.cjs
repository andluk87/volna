function createUpdates({updater,version,supported,publish,install,inCall=()=>false}){
 let state={status:supported?'idle':'unsupported',currentVersion:version,version:'',percent:0,message:'',manual:false},checking=false,downloading=false,installRequested=false;
 const set=patch=>{state={...state,...patch};publish({...state});};
 const fail=()=>{checking=downloading=installRequested=false;set({status:'error',message:'Не удалось обновить Волну. Проверьте соединение и повторите.'});};
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
 const apply=()=>{if(state.status!=='ready'||!supported)return false;if(inCall()){installRequested=false;set({message:'Обновление готово. Завершите звонок и нажмите «Перезапустить».'});return false;}installRequested=false;set({status:'installing',message:'Устанавливаем обновление…'});try{install();return true;}catch{fail();return false;}};
 updater.on('checking-for-update',()=>set({status:'checking',message:'Проверяем обновления…'}));
 updater.on('update-not-available',()=>{checking=false;set({status:'current',version:'',message:'Установлена последняя версия'});});
 updater.on('update-available',info=>{checking=false;set({status:'available',version:String(info.version),percent:0,message:'Доступна новая версия Волны'});});
 updater.on('download-progress',p=>{if(downloading)set({status:'downloading',percent:Math.min(100,Math.max(0,Number(p.percent)||0)),message:'Скачиваем обновление…'});});
 updater.on('update-downloaded',info=>{if(!downloading)return;downloading=false;set({status:'ready',version:String(info.version),percent:100,message:'Обновление готово'});if(installRequested)apply();});
 updater.on('error',fail);
 return {snapshot:()=>({...state}),async check(manual=false){if(!supported||checking||downloading||['ready','installing'].includes(state.status))return {...state};checking=true;set({manual});try{await updater.checkForUpdates();}catch{fail();}finally{checking=false;}return {...state};},async update(){if(state.status==='ready'){apply();return {...state};}if(!supported||downloading||state.status!=='available')return {...state};downloading=true;installRequested=true;set({status:'downloading',percent:0,manual:true,message:'Скачиваем обновление…'});try{await updater.downloadUpdate();}catch{fail();}return {...state};},install:apply};
}
module.exports={createUpdates};
