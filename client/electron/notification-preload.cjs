const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('vlnToast',{
 subscribe(callback){const listener=(_event,entries)=>callback(entries);ipcRenderer.on('vln:toasts',listener);return()=>ipcRenderer.removeListener('vln:toasts',listener);},
 open:id=>ipcRenderer.send('vln:toast-open',id),close:id=>ipcRenderer.send('vln:toast-close',id)
});
