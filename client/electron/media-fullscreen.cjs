const previous=new WeakMap();
function mediaFullscreen(window,enabled){
 if(typeof enabled!=='boolean')throw Error('Invalid media fullscreen state');
 if(!window||window.isDestroyed())return false;
 if(enabled){if(!previous.has(window)){previous.set(window,window.isFullScreen());window.setFullScreen(true);}}
 else if(previous.has(window)){const was=previous.get(window);previous.delete(window);window.setFullScreen(was);}
 return true;
}
module.exports={mediaFullscreen};
