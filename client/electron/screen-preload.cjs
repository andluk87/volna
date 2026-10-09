const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('screenPicker',{onSources:callback=>ipcRenderer.once('desktop:screen-sources',(_event,sources)=>callback(sources)),choose:id=>ipcRenderer.send('desktop:pick-screen',id)});
