const {app,BrowserWindow,protocol,net,session,dialog,ipcMain,shell,Tray,Menu,Notification,desktopCapturer,safeStorage,screen}=require('electron');
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {trustedRenderer,externalURL,validateConfig,rendererFile}=require('./desktop-core.cjs');
const {restoredBounds,readWindowState,trackWindowState,desktopShortcut}=require('./window-state.cjs');
const {createUpdates}=require('./updates.cjs');const {pickScreen}=require('./screen-picker.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let win,tray,quitting=false,config,updates,activeCall=false,lastIncoming='',callNotification;
const show=()=>{if(!win||win.isDestroyed())createWindow();if(win.isMinimized())win.restore();win.show();win.focus();win.flashFrame(false);};
function createWindow(){
 const stateFile=path.join(app.getPath('userData'),'window-state.json'),saved=readWindowState(stateFile);
 win=new BrowserWindow({...restoredBounds(saved,screen.getAllDisplays()),minWidth:390,minHeight:500,title:'Волна',backgroundColor:'#17212b',autoHideMenuBar:true,show:false,icon:path.join(app.getAppPath(),'dist/icons/icon-192.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 trackWindowState(win,stateFile);if(saved.maximized===true)win.maximize();
 win.once('ready-to-show',()=>win.show());
 win.webContents.on('before-input-event',(event,input)=>{const shortcut=desktopShortcut(input);if(!shortcut)return;event.preventDefault();if(shortcut==='close')win.close();else win.webContents.send('desktop:shortcut',shortcut);});const external=url=>{const target=externalURL(url);if(target)shell.openExternal(target).catch(()=>{});};
 win.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});win.webContents.on('will-navigate',(event,url)=>{event.preventDefault();external(url);});
 win.on('close',event=>{if(!quitting&&tray){event.preventDefault();win.hide();}});win.loadURL('app://volna/index.html');
}

function ipc(channel,fn){ipcMain.handle(channel,(event,...args)=>{if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trustedRenderer(event.senderFrame?.url))throw Error('Untrusted desktop request');return fn(...args);});}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',(_event,argv)=>{show();});

 app.whenReady().then(()=>{
  config=validateConfig(JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')));app.setAppUserModelId('dev.volna.messenger');
  const root=path.join(app.getAppPath(),'dist');protocol.handle('app',request=>{const file=rendererFile(root,request.url);return file?net.fetch(pathToFileURL(file).toString()):new Response('Not found',{status:404});});
  let microphoneAllowed=false;
  session.defaultSession.setPermissionCheckHandler((_contents,permission,origin,details)=>trustedRenderer(origin)&&(['notifications','display-capture'].includes(permission)||permission==='media'&&microphoneAllowed&&['audio','unknown'].includes(details.mediaType)));
  session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
   if(!trustedRenderer(details.requestingUrl))return callback(false);if(['notifications','display-capture'].includes(permission))return callback(true);
   if(permission!=='media'||!details.mediaTypes?.length||details.mediaTypes.some(type=>type!=='audio'))return callback(false);if(microphoneAllowed)return callback(true);
   try{const result=await dialog.showMessageBox(BrowserWindow.fromWebContents(contents),{type:'question',title:'Микрофон',message:'Разрешить микрофон для голосовых сообщений и звонков?',buttons:['Разрешить','Отмена'],defaultId:0,cancelId:1});microphoneAllowed=result.response===0;callback(microphoneAllowed);}catch{callback(false);}
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
   if(!request.frame||request.frame!==win?.webContents.mainFrame||!trustedRenderer(request.securityOrigin)||!request.userGesture||!request.videoRequested)return callback({});
   try{const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:320,height:180},fetchWindowIcons:true}),selected=await pickScreen(win,sources);if(!request.frame.isDestroyed()&&selected)callback({video:selected});else callback({});}catch{callback({});}
  });
  Menu.setApplicationMenu(null);createWindow();tray=new Tray(path.join(root,'icons/icon-192.png'));tray.setToolTip('Волна');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Волну',click:show},{label:'Проверить обновления',click:()=>{show();updates.check(true);}},{type:'separator'},{label:'Выйти',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',show);
  const {autoUpdater}=require('electron-updater');updates=createUpdates({updater:autoUpdater,version:app.getVersion(),supported:app.isPackaged&&process.platform==='win32',publish:state=>{if(!win.isDestroyed())win.webContents.send('desktop:update-state',state);},inCall:()=>activeCall,install:()=>{quitting=true;autoUpdater.quitAndInstall(true,true);}});
  ipc('desktop:unread',count=>{if(!Number.isSafeInteger(count)||count<0||count>1000000)throw Error('Invalid unread count');app.setBadgeCount(count);tray?.setToolTip(count?'Волна · Непрочитанных: '+count:'Волна');return true;});
  ipc('desktop:update-state',()=>updates.snapshot());ipc('desktop:check-update',()=>updates.check(true));ipc('desktop:update',()=>updates.update());
  const sessionFile=path.join(app.getPath('userData'),'phone-session.dat');
  ipc('desktop:save-session',refresh=>{if(typeof refresh!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(refresh))throw Error('Invalid session');if(!safeStorage.isEncryptionAvailable())throw Error('Secure storage unavailable');const temp=sessionFile+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(refresh),{mode:0o600});fs.renameSync(temp,sessionFile);return true;});
  ipc('desktop:load-session',()=>{try{if(!safeStorage.isEncryptionAvailable())return null;const refresh=safeStorage.decryptString(fs.readFileSync(sessionFile));return /^[A-Za-z0-9_-]{43}$/.test(refresh)?refresh:null;}catch{return null;}});
  ipc('desktop:clear-session',()=>{fs.rmSync(sessionFile,{force:true});return true;});
  ipc('desktop:notify',value=>{if(!value||!Number.isSafeInteger(value.chatId)||value.chatId<=0||win.isFocused())return;const notification=new Notification({title:String(value.title||'Волна').slice(0,80),body:String(value.body||'Новое сообщение').slice(0,240),icon:path.join(root,'icons/icon-192.png')});notification.on('click',()=>{show();win.webContents.send('desktop:open-chat',value.chatId);});notification.show();});
  ipc('desktop:call',value=>{activeCall=value?.active===true;if(!activeCall)lastIncoming='';if(!value?.incoming&&callNotification){callNotification.close();callNotification=undefined;win.flashFrame(false);}if(value?.incoming&&value.id!==lastIncoming&&typeof value.id==='string'){callNotification?.close();lastIncoming=value.id;win.flashFrame(true);const notification=new Notification({title:'Входящий звонок · Волна',body:String(value.name||'Собеседник').slice(0,80),timeoutType:'never',icon:path.join(root,'icons/icon-192.png')});callNotification=notification;notification.on('click',()=>{show();win.webContents.send('desktop:show-call');});notification.show();}});
  setTimeout(()=>updates.check(),5_000).unref();setInterval(()=>updates.check(),6*60*60*1000).unref();
 }).catch(error=>{dialog.showErrorBox('Волна не запустилась',error.message);quitting=true;app.quit();});
}
app.on('before-quit',()=>{quitting=true;});app.on('window-all-closed',()=>{if(!tray)app.quit();});
