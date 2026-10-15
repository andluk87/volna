const path=require('node:path');
const {createNotificationStack}=require('./notification-stack.cjs');
function createNotificationWindow({BrowserWindow,screen,ipcMain,open,parent}) {
 let window,loaded=false,latest=[];
 function render(entries){latest=entries;if(!entries.length){window?.hide();return;}if(!window||window.isDestroyed()){
  loaded=false;window=new BrowserWindow({width:360,height:100,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:{preload:path.join(__dirname,'notification-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.once('did-finish-load',()=>{loaded=true;render(latest);});window.loadFile(path.join(__dirname,'notification.html'));
 }
 if(!loaded)return;
 const main=parent(),bounds=main&&!main.isDestroyed()?main.getBounds():null;
 const area=(bounds?screen.getDisplayMatching(bounds):screen.getPrimaryDisplay()).workArea;
 const width=Math.min(360,area.width-20),height=Math.min(latest.length*108+12,area.height-20);
 window.setBounds({x:area.x+area.width-width-10,y:area.y+area.height-height-10,width,height});
 window.webContents.send('vln:toasts',latest);window.showInactive();
 }
 const stack=createNotificationStack({publish:render,open});
 const trusted=event=>window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame;
 const activate=(event,id)=>{if(trusted(event)&&Number.isSafeInteger(id))stack.activate(id);};
 const dismiss=(event,id)=>{if(trusted(event)&&Number.isSafeInteger(id))stack.remove(id);};
 ipcMain.on('vln:toast-open',activate);ipcMain.on('vln:toast-close',dismiss);
 return {push:stack.push,dispose(){stack.clear();ipcMain.removeListener('vln:toast-open',activate);ipcMain.removeListener('vln:toast-close',dismiss);window?.destroy();}};
}
module.exports={createNotificationWindow};
