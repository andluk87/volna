const {contextBridge,ipcRenderer}=require('electron');
const listen=(channel,callback)=>{const fn=(_event,value)=>callback(value);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);};
contextBridge.exposeInMainWorld('volnaDesktop',{
 updateState:()=>ipcRenderer.invoke('desktop:update-state'),checkUpdates:()=>ipcRenderer.invoke('desktop:check-update'),update:()=>ipcRenderer.invoke('desktop:update'),
 saveSession:value=>ipcRenderer.invoke('desktop:save-session',value),loadSession:()=>ipcRenderer.invoke('desktop:load-session'),clearSession:()=>ipcRenderer.invoke('desktop:clear-session'),notifyMessage:value=>ipcRenderer.invoke('desktop:notify',value),callState:value=>ipcRenderer.invoke('desktop:call',value),
 onUpdate:callback=>listen('desktop:update-state',callback),onOpenChat:callback=>listen('desktop:open-chat',callback),onShowCall:callback=>listen('desktop:show-call',callback)
});
