import React from 'react';
import {Icon} from './ui';
import {formatTime} from './appearance.mjs';
/** Delivery metadata is shared by inline text, media and deleted messages. */
export default function MessageMeta({message:m,own,chat,timeFormat='24'}){
 const read=chat.peer_read>=m.id,delivered=read||chat.peer_delivered>=m.id;
 return <span className="message-meta">{m.pinned&&<Icon name="pin"/>}{m.edited_at&&!m.deleted_at&&<span>изменено</span>}<time dateTime={m.created_at}>{formatTime(m.created_at,timeFormat)}</time>{own&&chat.kind!=='channel'&&<span aria-label={read?'Прочитано':delivered?'Доставлено':'Отправлено'} className={read?'read':''}>{delivered?<span className="delivery-checks"><Icon name="check"/><Icon name="check"/></span>:<Icon name="check"/>}</span>}</span>;
}
