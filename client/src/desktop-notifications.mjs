const key='volna.desktop.notifications';
export function desktopNotificationSettings(){try{const v=JSON.parse(localStorage.getItem(key)||'{}');return {enabled:v.enabled!==false,preview:v.preview===true};}catch{return {enabled:true,preview:false};}}
export function saveDesktopNotificationSettings(v){localStorage.setItem(key,JSON.stringify({enabled:v.enabled===true,preview:v.preview===true}));}
export function notifyDesktopMessage(m){const s=desktopNotificationSettings();if(s.enabled)window.volnaDesktop?.notifyMessage({chatId:m.chat_id,title:s.preview?(m.topic_id?m.group_name+' › '+m.topic_name:m.sender_name||'Волна'):'Волна',body:s.preview?m.text||'Новое вложение':'Новое сообщение'}).catch(()=>{});}
