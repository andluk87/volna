const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function columnLayout(viewport,desktop,preferred){
 const mobile=viewport<=(desktop?760:600),gutter=desktop?0:16;
 const min=desktop?300:320,max=desktop?600:480;
 const wanted=Number.isFinite(preferred)?clamp(preferred,min,max):(desktop?392:360);
 const sidebar=mobile?viewport:clamp(wanted,min,Math.max(min,Math.min(max,viewport-(desktop?360:360)-gutter*3)));
 const info=desktop?320:360;
 return {mobile,showDivider:viewport>(desktop?760:925),sidebar,min,max,gutter,info,dockInfo:!mobile&&viewport>=sidebar+info+(desktop?440:696)+gutter*4,dockEmoji:desktop&&!mobile&&viewport>=sidebar+300+560};
}
