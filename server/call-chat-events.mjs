// Call records stay separate from messages: no duplicate bubbles or fake message ids.
export function callTitle(call, uid) {
 const incoming=call.callee===uid;
 if(call.answered!==null||call.status==='ended')return incoming?'Входящий звонок':'Исходящий звонок';
 return incoming?'Пропущенный звонок':'Отменённый звонок';
}
export function applyCallPreviews(db,uid,rows) {
 const records=db.prepare(`SELECT * FROM (
  SELECT h.*,ROW_NUMBER() OVER(PARTITION BY h.chat_id ORDER BY h.created DESC,h.id DESC) AS position,
   SUM(CASE WHEN h.callee=? AND h.callee_read=0 THEN 1 ELSE 0 END) OVER(PARTITION BY h.chat_id) AS unread_calls
  FROM call_history h JOIN members m ON m.chat_id=h.chat_id AND m.user_id=?
  WHERE h.ended IS NOT NULL AND (h.caller=? OR (h.callee=? AND h.ringed=1))
   AND NOT EXISTS(SELECT 1 FROM call_history_hidden x WHERE x.call_id=h.id AND x.user_id=?)
 ) WHERE position=1`).all(uid,uid,uid,uid,uid);
 const byChat=new Map(records.map(c=>[c.chat_id,c]));
 return rows.map(row=>{
  const call=row.kind==='direct'?byChat.get(row.id):null;
  if(!call)return row;
  const at=new Date(call.created).toISOString();
  return {...row,unread:row.unread+call.unread_calls,...(!row.last_at||Date.parse(row.last_at)<call.created?{
   last_text:callTitle(call,uid),last_at:at,last_id:null,last_sender_id:null,
   last_call:{id:call.id,incoming:call.callee===uid,video:!!call.video,unanswered:call.answered===null}
  }:{})};
 });
}
