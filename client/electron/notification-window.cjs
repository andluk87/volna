const path=require('node:path');
const {createNotificationStack}=require('./notification-stack.cjs');
function createNotificationWindow({BrowserWindow,screen,ipcMain,open,parent}) {
 let window,loaded=false,latest=[],corner='bottom-right',pendingSound=null;
 function ensureWindow(){if(!window||window.isDestroyed()){
  loaded=false;window=new BrowserWindow({width:360,height:100,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,show:false,webPreferences:{preload:path.join(__dirname,'notification-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.once('did-finish-load',()=>{loaded=true;render(latest);if(pendingSound){window.webContents.send('vln:toast-sound',pendingSound);pendingSound=null;}});window.loadFile(path.join(__dirname,'notification.html'));
 }}
 function render(entries){latest=entries;if(!entries.length){window?.hide();return;}ensureWindow();
 if(!loaded)return;
 const main=parent(),bounds=main&&!main.isDestroyed()?main.getBounds():null;
 const area=(bounds?screen.getDisplayMatching(bounds):screen.getPrimaryDisplay()).workArea;
 const width=Math.min(360,area.width-20),height=Math.min(latest.length*108+12,area.height-20);
 window.setBounds({x:corner.endsWith('left')?area.x+10:area.x+area.width-width-10,y:corner.startsWith('top')?area.y+10:area.y+area.height-height-10,width,height});
 window.webContents.send('vln:toasts',latest);window.showInactive();
 }
 const stack=createNotificationStack({publish:render,open});
 const trusted=event=>window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame;
 const activate=(event,id)=>{if(trusted(event)&&Number.isSafeInteger(id))stack.activate(id);};
 const dismiss=(event,id)=>{if(trusted(event)&&Number.isSafeInteger(id))stack.remove(id);};
 ipcMain.on('vln:toast-open',activate);ipcMain.on('vln:toast-close',dismiss);
 return {push:stack.push,configure(settings){corner=settings.corner;stack.configure(settings.stackLimit);render(latest);},clear:stack.clear,playSound(volume){ensureWindow();const value={volume:Math.max(0,Math.min(100,Number(volume)||0))};if(loaded)window.webContents.send('vln:toast-sound',value);else pendingSound=value;},dispose(){stack.clear();ipcMain.removeListener('vln:toast-open',activate);ipcMain.removeListener('vln:toast-close',dismiss);window?.destroy();}};
}
module.exports={createNotificationWindow};
