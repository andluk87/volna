const fail=(status,message)=>Object.assign(Error(message),{status});
/** Menus belong to a server-registered bot, never to arbitrary message text or a display name. */
export function botMenus({db,json,member}){
 db.exec('CREATE TABLE IF NOT EXISTS bot_menus(user_id INTEGER PRIMARY KEY REFERENCES users(id),owner_id INTEGER REFERENCES users(id),commands TEXT NOT NULL)');
 function register(userId,commands,owner=null){
  if(!Array.isArray(commands)||commands.length>20||commands.some(x=>!/^\/[a-z][a-z0-9_]{0,31}$/.test(x.command)||typeof x.description!=='string'||!x.description.trim()||x.description.length>120)||new Set(commands.map(x=>x.command)).size!==commands.length)throw Error('Invalid bot command menu');
  const value=JSON.stringify(commands.map(({command,description})=>({command,description})));
  db.prepare('INSERT INTO bot_menus VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner_id=excluded.owner_id,commands=excluded.commands WHERE commands<>excluded.commands OR owner_id IS NOT excluded.owner_id').run(userId,owner,value);
 }
 function commands(uid,chat){
  member(chat,uid);
  const row=db.prepare("SELECT b.commands,b.owner_id FROM chats c JOIN members m ON m.chat_id=c.id AND m.user_id<>? JOIN bot_menus b ON b.user_id=m.user_id WHERE c.id=? AND c.kind='direct' AND (SELECT COUNT(*) FROM members WHERE chat_id=c.id)=2").get(uid,chat);
  return !row||row.owner_id!==null&&row.owner_id!==uid?[]:JSON.parse(row.commands);
 }
 function handle(req,res,url,uid){const match=url.pathname.match(/^\/api\/chats\/(\d+)\/bot-commands$/);if(!match)return false;if(req.method!=='GET')throw fail(405,'Метод не поддерживается');const chat=Number(match[1]);if(!Number.isSafeInteger(chat)||chat<1)throw fail(400,'Некорректный чат');json(res,200,{commands:commands(uid,chat)});return true;}
 return {register,commands,handle};
}
