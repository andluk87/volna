export const notificationDefaults={enabled:true,allAccounts:true,showName:true,showText:true,trayFlash:true,sound:true,volume:100,direct:true,groups:true,channels:true,reactions:true,mutedBadge:true,mutedFolderBadge:true,countMessages:true,useNative:false,respectFocus:false,corner:'bottom-right',stackLimit:5};
export function normalizeNotificationSettings(value={}) {
 const v=value&&typeof value==='object'?value:{},result={...notificationDefaults};
 for(const key of Object.keys(result))if(typeof result[key]==='boolean')result[key]=typeof v[key]==='boolean'?v[key]:result[key];
 if(v.preview===false){if(v.showName===undefined)result.showName=false;if(v.showText===undefined)result.showText=false;}
 result.volume=Number.isFinite(Number(v.volume))?Math.max(0,Math.min(100,Math.round(Number(v.volume)))):100;
 result.stackLimit=Number.isFinite(Number(v.stackLimit))?Math.max(1,Math.min(5,Math.round(Number(v.stackLimit)))):5;
 result.corner=['top-left','top-right','bottom-left','bottom-right'].includes(v.corner)?v.corner:'bottom-right';
 return result;
}
export function notificationAllowed(settings,{accountId,selected,kind='direct',muted=false,reaction=false}) {
 const s=normalizeNotificationSettings(settings);
 return (!muted)&&(s.allAccounts||!selected||accountId===selected)&&(reaction?s.reactions:kind==='channel'?s.channels:kind==='group'?s.groups:s.direct);
}
export function notificationUnreadCount(chats,settings,folder=false){const s=normalizeNotificationSettings(settings);return chats.filter(c=>!c.parent_id&&(!c.muted||(folder?s.mutedFolderBadge:s.mutedBadge))).reduce((sum,c)=>sum+(s.countMessages?Math.max(0,Number(c.unread)||0):(c.unread>0||c.manual_unread?1:0)),0);}
