const {contextBridge,ipcRenderer}=require('electron');
const listen=(channel,callback)=>{const fn=(_event,value)=>callback(value);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);};
contextBridge.exposeInMainWorld('volnaDesktop',{
 notificationStatus:()=>ipcRenderer.invoke('desktop:notification-status'),notificationSettings:()=>ipcRenderer.invoke('desktop:notification-settings'),
 platform:process.platform,unreadCount:value=>ipcRenderer.invoke('desktop:unread',value),onShortcut:callback=>listen('desktop:shortcut',callback),
 updateState:()=>ipcRenderer.invoke('desktop:update-state'),checkUpdates:()=>ipcRenderer.invoke('desktop:check-update'),update:()=>ipcRenderer.invoke('desktop:update'),
 saveSession:value=>ipcRenderer.invoke('desktop:save-session',value),loadSession:()=>ipcRenderer.invoke('desktop:load-session'),clearSession:()=>ipcRenderer.invoke('desktop:clear-session'),notifyMessage:value=>ipcRenderer.invoke('desktop:notify',value),callState:value=>ipcRenderer.invoke('desktop:call',value),
 onUpdate:callback=>listen('desktop:update-state',callback),onOpenChat:callback=>listen('desktop:open-chat',callback),onShowCall:callback=>listen('desktop:show-call',callback)
});
