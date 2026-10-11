const fail=(status,message)=>Object.assign(new Error(message),{status});
export function accountAppearance({db,body,json}) {
 db.exec('CREATE TABLE IF NOT EXISTS account_appearance(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, settings TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,platform))');
 return async(req,res,url,uid)=>{
  const match=url.pathname.match(/^\/api\/me\/appearance\/(android|web|windows)$/);if(!match)return false;
  const platform=match[1];
  if(req.method==='GET'){const row=db.prepare('SELECT settings,updated_at FROM account_appearance WHERE user_id=? AND platform=?').get(uid,platform);json(res,200,{settings:row?JSON.parse(row.settings):null,updated_at:row?.updated_at||null});return true;}
  if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
  const data=await body(req);if(!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))throw fail(400,'Некорректное оформление');
  const settings=JSON.stringify(data.settings);if(Buffer.byteLength(settings)>12000000)throw fail(413,'Слишком большое оформление');
  // Store appearance only: credentials and notification permissions never belong here.
  const allowed=platform==='android'?['appearance','themes','images']:['theme','size','font','density','radius','accent','background','backgroundColor','animations','avatars','time','themeVariant','timeFormat','blur','powerSaving','wallpaper'];
  if(Object.keys(data.settings).some(key=>!allowed.includes(key)))throw fail(400,'Неизвестное поле оформления');
  if(platform==='android'){
   for(const section of ['appearance','themes']){
    const values=data.settings[section];if(!values||typeof values!=='object'||Array.isArray(values))throw fail(400,'Некорректные настройки');
    for(const [key,row] of Object.entries(values)){
     if(key.length>100||!row||!['string','boolean','int','long','float'].includes(row.type))throw fail(400,'Некорректное значение');
     if(row.type==='string'?typeof row.value!=='string':row.type==='boolean'?typeof row.value!=='boolean':!Number.isFinite(row.value))throw fail(400,'Некорректный тип');
    }
   }
   const images=data.settings.images||{};if(typeof images!=='object'||Array.isArray(images))throw fail(400,'Некорректные обои');
   for(const [name,value] of Object.entries(images))if(!/^[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(name)||typeof value!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length>7000000)throw fail(400,'Некорректные обои');
  }else if(data.settings.wallpaper!==undefined && (typeof data.settings.wallpaper!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.settings.wallpaper)||data.settings.wallpaper.length>7000000))throw fail(400,'Некорректные обои');
  const updated_at=new Date().toISOString();db.prepare('INSERT INTO account_appearance VALUES(?,?,?,?) ON CONFLICT(user_id,platform) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(uid,platform,settings,updated_at);
  json(res,200,{settings:data.settings,updated_at});return true;
 };
}
