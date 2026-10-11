const {app,BrowserWindow,protocol,net,session,dialog,ipcMain,shell,Tray,Menu,Notification,desktopCapturer,safeStorage,screen}=require('electron');
const {notificationState}=require('./notification-state.cjs');
const {ignoredSpelling}=require('./ignored-spelling.cjs');
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const {trustedRenderer,externalURL,validateConfig,rendererFile}=require('./desktop-core.cjs');
const {restoredBounds,readWindowState,trackWindowState,desktopShortcut}=require('./window-state.cjs');
const {createUpdates}=require('./updates.cjs');const {pickScreen}=require('./screen-picker.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const appWindows=new Set(),editorFocus=new WeakMap();
let win,tray,quitting=false,config,updates,activeCall=false,lastIncoming='',callNotification,spellingDictionary,selectedAccountId=null;
const show=()=>{if(!win||win.isDestroyed())createWindow();if(win.isMinimized())win.restore();win.show();win.focus();win.flashFrame(false);};
function createWindow(chatId=null,accountId=null){
 const secondary=chatId!==null;
 const stateFile=path.join(app.getPath('userData'),'window-state.json'),saved=readWindowState(stateFile);
 const window=new BrowserWindow({...restoredBounds(saved,screen.getAllDisplays()),minWidth:390,minHeight:500,title:'Волна',backgroundColor:'#17212b',autoHideMenuBar:true,show:false,icon:path.join(app.getAppPath(),'dist/icons/icon-192.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,spellcheck:true,additionalArguments:secondary?['--volna-chat-window']:[]}});
 appWindows.add(window);if(!secondary)win=window;window.on('closed',()=>appWindows.delete(window));
 if(!secondary){trackWindowState(window,stateFile);if(saved.maximized===true)window.maximize();}
 window.once('ready-to-show',()=>window.show());
 window.webContents.on('before-input-event',(event,input)=>{const shortcut=desktopShortcut(input);if(!shortcut||editorFocus.get(window.webContents)&&shortcut==='search')return;event.preventDefault();if(shortcut==='close')window.close();else window.webContents.send('desktop:shortcut',shortcut);});const external=url=>{const target=externalURL(url);if(target)shell.openExternal(target).catch(()=>{});};
 window.webContents.on('context-menu',(_event,params)=>{
  if(!params.isEditable||!trustedRenderer(window.webContents.getURL()))return;
  const editingComposer=editorFocus.get(window.webContents),flags=params.editFlags||{},formatting=[['bold','Жирный','CmdOrCtrl+B'],['italic','Курсив','CmdOrCtrl+I'],['underline','Подчёркнутый','CmdOrCtrl+U'],['strike','Зачёркнутый'],['inline','Моноширинный'],['code','Блок кода'],['spoiler','Спойлер'],['quote','Цитата'],['link','Гиперссылка','CmdOrCtrl+K']].map(([kind,label,accelerator])=>({label,accelerator,registerAccelerator:false,click:()=>window.webContents.send('desktop:format',kind)}));
  const spelling=(params.dictionarySuggestions||[]).slice(0,8).map(word=>({label:word,click:()=>window.webContents.replaceMisspelling(word)}));
  if(params.misspelledWord)spelling.unshift({label:'Добавить в словарь',click:()=>spellingDictionary.add(params.misspelledWord)},{label:'Игнорировать слово',click:()=>{if(!spellingDictionary.ignore(params.misspelledWord))dialog.showMessageBox(window,{type:'info',message:'Системный словарь не поддерживает временное исключение этого слова.'});}},{type:'separator'});
  spelling.push({label:'Проверять орфографию',type:'checkbox',checked:window.webContents.session.isSpellCheckerEnabled(),click:item=>window.webContents.session.setSpellCheckerEnabled(item.checked)});
  const menu=Menu.buildFromTemplate([(editingComposer?{label:'Отменить',accelerator:'CmdOrCtrl+Z',registerAccelerator:false,click:()=>window.webContents.send('desktop:editor-command','undo')}:{label:'Отменить',role:'undo',enabled:flags.canUndo}),(editingComposer?{label:'Повторить',accelerator:'CmdOrCtrl+Y',registerAccelerator:false,click:()=>window.webContents.send('desktop:editor-command','redo')}:{label:'Повторить',role:'redo',enabled:flags.canRedo}),{type:'separator'},{label:'Вырезать',role:'cut',enabled:flags.canCut},{label:'Копировать',role:'copy',enabled:flags.canCopy},{label:'Вставить',role:'paste',enabled:flags.canPaste},{label:'Удалить',role:'delete',enabled:flags.canDelete},{type:'separator'},{label:'Форматирование',enabled:editingComposer,submenu:formatting},{type:'separator'},{label:'Выбрать всё',role:'selectAll',enabled:flags.canSelectAll},{label:'Проверка орфографии',submenu:spelling}]);menu.popup({window:window});
 });
 window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});window.webContents.on('will-navigate',(event,url)=>{event.preventDefault();external(url);});
 window.on('close',event=>{if(!secondary&&!quitting&&tray){event.preventDefault();window.hide();}});window.loadURL('app://volna/index.html'+(secondary?'?chat='+chatId+'&account='+accountId:''));
 return window;
}

function ipc(channel,fn){ipcMain.handle(channel,(event,...args)=>{if(![...appWindows].some(window=>!window.isDestroyed()&&event.sender===window.webContents)||event.senderFrame!==event.sender.mainFrame||!trustedRenderer(event.senderFrame?.url))throw Error('Untrusted desktop request');return fn(...args,event);});}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',(_event,argv)=>{show();});

 app.whenReady().then(()=>{
  config=validateConfig(JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')));app.setAppUserModelId('dev.volna.messenger');
  const root=path.join(app.getAppPath(),'dist');protocol.handle('app',request=>{const file=rendererFile(root,request.url);return file?net.fetch(pathToFileURL(file).toString()):new Response('Not found',{status:404});});
  let microphoneAllowed=false,cameraAllowed=false;
  session.defaultSession.setPermissionCheckHandler((_contents,permission,origin,details)=>trustedRenderer(origin)&&(['notifications','display-capture'].includes(permission)||permission==='media'&&(details.mediaType==='audio'&&microphoneAllowed||details.mediaType==='video'&&cameraAllowed)));
  session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
   if(!trustedRenderer(details.requestingUrl))return callback(false);if(['notifications','display-capture'].includes(permission))return callback(true);
   if(permission!=='media'||!details.mediaTypes?.length||details.mediaTypes.some(type=>!['audio','video'].includes(type)))return callback(false);const audio=details.mediaTypes.includes('audio'),video=details.mediaTypes.includes('video');if((!audio||microphoneAllowed)&&(!video||cameraAllowed))return callback(true);
   try{const result=await dialog.showMessageBox(BrowserWindow.fromWebContents(contents),{type:'question',title:video?'Камера и микрофон':'Микрофон',message:video?'Разрешить камеру для видеозвонка?':'Разрешить микрофон для голосовых сообщений и звонков?',buttons:['Разрешить','Отмена'],defaultId:0,cancelId:1});const allowed=result.response===0;if(allowed){if(audio)microphoneAllowed=true;if(video)cameraAllowed=true;}callback(allowed);}catch{callback(false);}
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
   if(!request.frame||request.frame!==win?.webContents.mainFrame||!trustedRenderer(request.securityOrigin)||!request.userGesture||!request.videoRequested)return callback({});
   try{const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:320,height:180},fetchWindowIcons:true}),selected=await pickScreen(win,sources);if(!request.frame.isDestroyed()&&selected)callback({video:selected});else callback({});}catch{callback({});}
  });
  spellingDictionary=ignoredSpelling(session.defaultSession,path.join(app.getPath('userData'),'ignored-spelling.json'));
  Menu.setApplicationMenu(null);createWindow();tray=new Tray(path.join(root,'icons/icon-192.png'));tray.setToolTip('Волна');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Волну',click:show},{label:'Проверить обновления',click:()=>{show();updates.check(true);}},{type:'separator'},{label:'Выйти',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',show);
  const {autoUpdater}=require('electron-updater');updates=createUpdates({updater:autoUpdater,version:app.getVersion(),supported:app.isPackaged&&process.platform==='win32',publish:state=>{if(!win.isDestroyed())win.webContents.send('desktop:update-state',state);},inCall:()=>activeCall,install:()=>{quitting=true;autoUpdater.quitAndInstall(true,true);}});
  ipc('desktop:editor-focus',(value,event)=>{editorFocus.set(event.sender,value===true);});
  ipc('desktop:open-window',value=>{if(!Number.isSafeInteger(value?.chatId)||value.chatId<1||!Number.isSafeInteger(value.accountId)||value.accountId<1)throw Error('Invalid chat');createWindow(value.chatId,value.accountId);return true;});
  ipc('desktop:start-call',value=>{if(!Number.isSafeInteger(value?.chatId)||value.chatId<1||!Number.isSafeInteger(value.accountId)||value.accountId<1||typeof value.video!=='boolean')throw Error('Invalid call');show();win.webContents.send('desktop:start-call',value);return true;});
  ipc('desktop:unread',(count,event)=>{if(event.sender!==win.webContents)return false;if(!Number.isSafeInteger(count)||count<0||count>1000000)throw Error('Invalid unread count');app.setBadgeCount(count);tray?.setToolTip(count?'Волна · Непрочитанных: '+count:'Волна');return true;});
  ipc('desktop:update-state',()=>updates.snapshot());ipc('desktop:check-update',()=>updates.check(true));ipc('desktop:update',()=>updates.update());
  const sessionFile=path.join(app.getPath('userData'),'phone-session.dat');
  const accountsFile=path.join(app.getPath('userData'),'accounts.dat');
  const validAccounts=value=>value&&Array.isArray(value.accounts)&&value.accounts.length<=5&&new Set(value.accounts.map(a=>a?.user?.id)).size===value.accounts.length&&value.accounts.every(a=>Number.isSafeInteger(a?.user?.id)&&a.user.id>0&&/^[A-Za-z0-9_-]{43}$/.test(a.token)&&/^[A-Za-z0-9_-]{43}$/.test(a.refresh_token)&&Number.isSafeInteger(a.expires))&&(value.selected===null||value.accounts.some(a=>a.user.id===value.selected))&&JSON.stringify(value).length<=100000;
  ipc('desktop:save-accounts',(value,event)=>{if(!validAccounts(value))throw Error('Invalid accounts');if(!safeStorage.isEncryptionAvailable())throw Error('Secure storage unavailable');if(event.sender!==win.webContents){try{const stored=JSON.parse(safeStorage.decryptString(fs.readFileSync(accountsFile)));value.selected=stored.selected;}catch{value.selected=null;}}else selectedAccountId=value.selected;try{const stored=JSON.parse(safeStorage.decryptString(fs.readFileSync(accountsFile)));value.accounts=value.accounts.map(a=>{const existing=stored.accounts.find(old=>old.user.id===a.user.id);return existing?.expires>a.expires?existing:a;});}catch{}const temp=accountsFile+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(temp,accountsFile);fs.rmSync(sessionFile,{force:true});return true;});
  ipc('desktop:load-accounts',()=>{try{if(!safeStorage.isEncryptionAvailable())return null;const value=JSON.parse(safeStorage.decryptString(fs.readFileSync(accountsFile)));return validAccounts(value)?value:null;}catch{return null;}});
  ipc('desktop:save-session',refresh=>{if(typeof refresh!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(refresh))throw Error('Invalid session');if(!safeStorage.isEncryptionAvailable())throw Error('Secure storage unavailable');const temp=sessionFile+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(refresh),{mode:0o600});fs.renameSync(temp,sessionFile);return true;});
  ipc('desktop:load-session',()=>{try{if(!safeStorage.isEncryptionAvailable())return null;const refresh=safeStorage.decryptString(fs.readFileSync(sessionFile));return /^[A-Za-z0-9_-]{43}$/.test(refresh)?refresh:null;}catch{return null;}});
  ipc('desktop:clear-session',()=>{fs.rmSync(sessionFile,{force:true});return true;});
  ipc('desktop:notification-settings',()=>shell.openExternal('ms-settings:notifications'));
  ipc('desktop:sound-settings',()=>shell.openExternal('ms-settings:sound'));
  ipc('desktop:notification-status',()=>notificationState(process.platform,Notification.isSupported()));
  ipc('desktop:notify',(value,event)=>{if(event.sender!==win.webContents)return;if(!value||!Number.isSafeInteger(value.chatId)||value.chatId<=0||(win.isFocused()&&(!value.accountId||value.accountId===selectedAccountId))||!Notification.isSupported())return;const notification=new Notification({title:String(value.title||'Волна').slice(0,80),body:String(value.body||'Новое сообщение').slice(0,240),icon:path.join(root,'icons/icon-192.png')});notification.on('click',()=>{show();win.webContents.send('desktop:open-chat',{chatId:value.chatId,accountId:value.accountId});});notification.show();});
  ipc('desktop:call',(value,event)=>{if(event.sender!==win.webContents)return;activeCall=value?.active===true;if(!activeCall)lastIncoming='';if(!value?.incoming&&callNotification){callNotification.close();callNotification=undefined;win.flashFrame(false);}if(value?.incoming&&value.id!==lastIncoming&&typeof value.id==='string'){callNotification?.close();lastIncoming=value.id;win.flashFrame(true);const notification=new Notification({title:'Входящий звонок · Волна',body:String(value.name||'Собеседник').slice(0,80),timeoutType:'never',icon:path.join(root,'icons/icon-192.png')});callNotification=notification;notification.on('click',()=>{show();win.webContents.send('desktop:show-call');});notification.show();}});
  setTimeout(()=>updates.check(),5_000).unref();setInterval(()=>updates.check(),6*60*60*1000).unref();
 }).catch(error=>{dialog.showErrorBox('Волна не запустилась',error.message);quitting=true;app.quit();});
}
app.on('before-quit',()=>{quitting=true;spellingDictionary?.clear();});app.on('window-all-closed',()=>{if(!tray)app.quit();});
