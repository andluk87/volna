import React from 'react';
export default function MessageSelectionBar({count,canDelete,onForward,onDelete,onCancel}){
 return <div className="selection-bar" role="toolbar" aria-label="Выбранные сообщения"><button className="selection-action" onClick={onForward}>Переслать <span>{count}</span></button><button className="selection-action" disabled={!canDelete} title={canDelete?undefined:'Можно удалить свои сообщения или сообщения, которыми вы управляете'} onClick={onDelete}>Удалить <span>{count}</span></button><button className="selection-cancel" onClick={onCancel}>Отмена</button></div>;
}
