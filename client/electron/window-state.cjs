const fs=require('node:fs');
const defaults={width:1180,height:800};
function restoredBounds(value,displays){
 const areas=displays.map(display=>display.workArea||display).filter(a=>[a.x,a.y,a.width,a.height].every(Number.isFinite)&&a.width>0&&a.height>0);
 if(!areas.length)return {...defaults};
 const saved=value&&[value.x,value.y,value.width,value.height].every(Number.isFinite)&&value.width>=390&&value.height>=500?value:null;
 const overlap=a=>saved?Math.max(0,Math.min(saved.x+saved.width,a.x+a.width)-Math.max(saved.x,a.x))*Math.max(0,Math.min(saved.y+saved.height,a.y+a.height)-Math.max(saved.y,a.y)):0;
 const area=areas.reduce((best,a)=>overlap(a)>overlap(best)?a:best,areas[0]);
 const width=Math.min(area.width,Math.max(390,saved?.width||defaults.width)),height=Math.min(area.height,Math.max(500,saved?.height||defaults.height));
 const visible=saved&&overlap(area)>0;
 return {width:Math.round(width),height:Math.round(height),x:Math.round(visible?Math.max(area.x,Math.min(saved.x,area.x+area.width-width)):area.x+(area.width-width)/2),y:Math.round(visible?Math.max(area.y,Math.min(saved.y,area.y+area.height-height)):area.y+(area.height-height)/2)};
}
function readWindowState(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function trackWindowState(win,file){let timer;const save=()=>{clearTimeout(timer);if(win.isDestroyed())return;try{const state={...win.getNormalBounds(),maximized:win.isMaximized()},temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state));fs.renameSync(temp,file);}catch{}};const queue=()=>{clearTimeout(timer);timer=setTimeout(save,250);timer.unref?.();};for(const event of ['resize','move','maximize','unmaximize'])win.on(event,queue);win.on('close',save);win.on('closed',()=>clearTimeout(timer));return save;}
function desktopShortcut(input){if(input.type!=='keyDown'||input.isAutoRepeat||input.meta)return null;const key=String(input.key).toLowerCase();if(input.control&&!input.alt){if(key==='k')return 'search';if(key==='f')return 'chat-search';if(key===',')return 'settings';if(key==='w')return 'close';}if(input.alt&&!input.control){if(key==='arrowup')return 'previous-chat';if(key==='arrowdown')return 'next-chat';}return null;}
module.exports={restoredBounds,readWindowState,trackWindowState,desktopShortcut};
