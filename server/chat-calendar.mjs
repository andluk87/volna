const fail=message=>Object.assign(Error(message),{status:400});
export function chatCalendar({db,uid,chat,params,hydrate}){
 const forum=params.get('forum')==='1',root=db.prepare('SELECT kind,parent_id FROM chats WHERE id=?').get(chat);
 if(forum&&(root.kind!=='group'||root.parent_id))throw fail('Общая лента доступна только для основной группы');
 const offset=Number(params.get('tz')||0);if(!Number.isInteger(offset)||Math.abs(offset)>840)throw fail('Некорректный часовой пояс');
 const scope=forum?'(c.id=? OR c.parent_id=?)':'c.id=?',args=[uid,uid,chat,...(forum?[chat]:[])];
 const from=`FROM messages m JOIN chats c ON c.id=m.chat_id JOIN members me ON me.chat_id=c.id AND me.user_id=? LEFT JOIN chat_visibility v ON v.chat_id=c.id AND v.user_id=? WHERE ${scope} AND c.topic_deleted=0 AND c.admin_deleted=0 AND m.deleted_at IS NULL AND m.id>COALESCE(v.hidden_before,0)`;
 if(params.has('date')){
  const date=params.get('date');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw fail('Некорректная дата');
  const start=new Date(Date.parse(date)+offset*60000).toISOString();
  const anchor=db.prepare(`SELECT m.id ${from} AND m.created_at>=? ORDER BY m.created_at,m.id LIMIT 1`).get(...args,start)||db.prepare(`SELECT m.id ${from} AND m.created_at<? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).get(...args,start);
  if(!anchor)return {messages:[],anchor_id:null,date};
  const before=db.prepare(`SELECT m.* ${from} AND m.id<=? ORDER BY m.id DESC LIMIT 25`).all(...args,anchor.id).reverse(),after=db.prepare(`SELECT m.* ${from} AND m.id>? ORDER BY m.id LIMIT 25`).all(...args,anchor.id);
  return {messages:[...before,...after].map(row=>hydrate(row)),anchor_id:anchor.id,date};
 }
 const month=params.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw fail('Выберите месяц');
 const start=Date.parse(month+'-01'),d=new Date(start);d.setUTCMonth(d.getUTCMonth()+1);
 const days=db.prepare(`SELECT date(m.created_at,?) date,COUNT(*) count ${from} AND m.created_at>=? AND m.created_at<? GROUP BY date ORDER BY date`).all((-offset)+' minutes',...args,new Date(start+offset*60000).toISOString(),new Date(d.getTime()+offset*60000).toISOString());
 return {month,days};
}
