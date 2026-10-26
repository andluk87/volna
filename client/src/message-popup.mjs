const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function fitMessagePopup({x,y,width,height,viewportWidth,viewportHeight,viewportTop=0,bounds,padding=8}){
 const vw=Math.max(1,viewportWidth),vh=Math.max(1,viewportHeight),gap=Math.min(padding,vw/4,vh/4);
 let leftEdge=gap,rightEdge=vw-gap;
 if(bounds&&bounds.right-bounds.left>=180){leftEdge=Math.max(gap,bounds.left+gap);rightEdge=Math.min(vw-gap,bounds.right-gap);}
 const fittedWidth=Math.max(1,Math.min(width,rightEdge-leftEdge));
 const topEdge=gap+Math.max(0,Math.min(viewportTop,vh-2*gap));
 const maxHeight=Math.max(1,vh-gap-topEdge),fittedHeight=Math.min(height,maxHeight);
 const left=clamp(x+4+fittedWidth<=rightEdge?x+4:x-fittedWidth-4,leftEdge,rightEdge-fittedWidth);
 const below=y+5,above=y-fittedHeight-5;
 const top=clamp(below+fittedHeight<=vh-gap?below:above>=topEdge?above:below,topEdge,vh-gap-fittedHeight);
 return {left,top,width:fittedWidth,maxHeight};
}
export function messageMenuContains(owner,target){
 const popup=target?.closest?.('[data-message-menu-owner]');
 return owner.contains(target)||!!popup&&popup.dataset.messageMenuOwner===owner.dataset.menuOwner;
}
