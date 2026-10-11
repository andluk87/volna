function createUpdates({updater,version,supported,publish,install,inCall=()=>false}){
 let state={status:supported?'idle':'unsupported',currentVersion:version,version:'',percent:0,message:'',manual:false},checking=false,downloading=false;
 const set=patch=>{state={...state,...patch};publish({...state});};
 const fail=()=>{checking=downloading=false;set({status:'error',message:'Не удалось обновить Волну. Проверьте соединение и повторите.'});};
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
 const apply=()=>{if(state.status!=='ready'||!supported)return false;if(inCall()){set({message:'Обновление готово. Завершите звонок перед перезапуском.'});return false;}set({status:'installing',message:'Устанавливаем обновление…'});try{install();return true;}catch{fail();return false;}};
 const download=async()=>{if(!supported||downloading||state.status!=='available')return;downloading=true;set({status:'downloading',percent:0,message:'Скачиваем обновление…'});try{await updater.downloadUpdate();}catch{fail();}};
 updater.on('checking-for-update',()=>set({status:'checking',message:'Проверяем обновления…'}));
 updater.on('update-not-available',()=>{checking=false;set({status:'current',version:'',message:'Установлена последняя версия'});});
 updater.on('update-available',info=>{checking=false;set({status:'available',version:String(info.version),percent:0,message:'Доступна новая версия Волны'});void download();});
 updater.on('download-progress',p=>{if(downloading)set({status:'downloading',percent:Math.min(100,Math.max(0,Number(p.percent)||0)),message:'Скачиваем обновление…'});});
 updater.on('update-downloaded',info=>{if(!downloading)return;downloading=false;set({status:'ready',version:String(info.version),percent:100,message:'Обновление скачано. Обновить сейчас или при следующем запуске?'});});
 updater.on('error',fail);
 return {snapshot:()=>({...state}),async check(manual=false){if(!supported||checking||downloading||['ready','installing'].includes(state.status))return {...state};checking=true;set({manual});try{await updater.checkForUpdates();}catch{fail();}finally{checking=false;}return {...state};},async update(){if(state.status==='ready')apply();else await download();return {...state};},defer(){if(state.status==='ready'){updater.autoInstallOnAppQuit=true;set({deferred:true,message:'Обновление установится при следующем запуске Волны'});}return {...state};},install:apply};
}
module.exports={createUpdates};
