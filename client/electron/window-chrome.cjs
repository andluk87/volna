const WINDOW_TITLEBAR_HEIGHT=28;
function windowChromeTheme(theme){
 if(!['light','dark'].includes(theme))throw Error('Invalid window theme');
 return theme==='light'?{color:'#f1f1f1',symbolColor:'#707579',background:'#ffffff'}:{color:'#242f3d',symbolColor:'#7f91a4',background:'#17212b'};
}
function windowChromeOptions(platform){
 if(platform!=='win32')return {};
 const {color,symbolColor}=windowChromeTheme('dark');
 return {titleBarStyle:'hidden',titleBarOverlay:{color,symbolColor,height:WINDOW_TITLEBAR_HEIGHT}};
}
function applyWindowChrome(window,theme,platform){
 const {color,symbolColor,background}=windowChromeTheme(theme);
 if(platform!=='win32'||!window||window.isDestroyed())return false;
 window.setBackgroundColor(background);window.setTitleBarOverlay({color,symbolColor,height:WINDOW_TITLEBAR_HEIGHT});return true;
}
module.exports={WINDOW_TITLEBAR_HEIGHT,windowChromeTheme,windowChromeOptions,applyWindowChrome};
