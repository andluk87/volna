const path=require('node:path');
function photoPayload(value){
 if(!value||!(value.bytes instanceof ArrayBuffer)&&!ArrayBuffer.isView(value.bytes))throw Error('Invalid photo');
 const bytes=Buffer.from(value.bytes instanceof ArrayBuffer?value.bytes:value.bytes.buffer,value.bytes.byteOffset||0,value.bytes.byteLength);
 if(!bytes.length||bytes.length>20*1024*1024)throw Error('Photo too large');
 const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,6).toString().match(/^GIF8[79]a$/)?'image/gif':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
 if(!type||type!==value.mime)throw Error('Invalid image format');
 const ext={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}[type];
 const base=path.basename(String(value.name||'Фото').replace(/\\/g,'/')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.[^.]+$/,'').slice(0,120).replace(/[. ]+$/,'')||'Фото';
 return {bytes,name:base+ext,reveal:value.reveal===true};
}
module.exports={photoPayload};
