const {BrowserWindow,ipcMain}=require('electron'),path=require('node:path'),{pathToFileURL}=require('node:url');
function pickScreen(parent,sources){if(!sources.length)return Promise.resolve(null);return new Promise(resolve=>{
 const file=path.join(__dirname,'screen-picker.html'),picker=new BrowserWindow({width:900,height:650,minWidth:520,minHeight:400,parent,modal:true,title:'Демонстрация экрана',backgroundColor:'#17212b',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'screen-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 let selected=null;const choose=(event,id)=>{if(event.sender!==picker.webContents||event.senderFrame!==picker.webContents.mainFrame||event.senderFrame?.url!==pathToFileURL(file).href)return;selected=sources.find(s=>s.id===id)||null;picker.close();};
 ipcMain.on('desktop:pick-screen',choose);picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));picker.webContents.on('will-navigate',event=>event.preventDefault());
 picker.webContents.once('did-finish-load',()=>picker.webContents.send('desktop:screen-sources',sources.map(s=>({id:s.id,name:s.name,thumbnail:s.thumbnail.toDataURL()}))));
 picker.once('closed',()=>{ipcMain.removeListener('desktop:pick-screen',choose);resolve(selected);});picker.loadFile(file).catch(()=>picker.close());
 });}
module.exports={pickScreen};
