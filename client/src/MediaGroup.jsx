import React from 'react';
export default function MediaGroup({group,own,date,meta,header,captions=[],children}){
 if(group.length===1)return <div className="message-group">{date}{children}</div>;
 return <>{date}<section className={'album-frame '+(own?'outgoing-album':'incoming-album')} aria-label={`Альбом: ${group.length} вложений`}>
 {header&&<div className="album-heading">{header}</div>}
 <div className="album-media"><div className="media-album">{children}</div>{!captions.length&&<div className="album-overlay-meta">{meta}</div>}</div>
 {captions.length>0&&<div className="album-captions">{captions}<div className="album-caption-meta">{meta}</div></div>}
 </section></>;
}
