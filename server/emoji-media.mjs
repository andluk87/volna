import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const signature=Buffer.from('89504e470d0a1a0a','hex');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
const invalid=reason=>{throw Object.assign(Error(reason),{status:400,code:'emoji_media_invalid'});};
/** Static PNG validation: bounded decompression, chunk CRC, dimensions and scanlines. */
export function inspectEmojiPng(bytes,{exact=false,maxBytes=262144}={}){
 if(bytes.length>maxBytes||bytes.length<45||!bytes.subarray(0,8).equals(signature))invalid('Эмодзи: статичный PNG до 256 КБ');
 let offset=8,header,ended=false,seenData=false,palette=false,data=[];
 while(offset<bytes.length){if(offset+12>bytes.length)invalid('Повреждённый PNG');const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(length>maxBytes||offset+12+length>bytes.length)invalid('Повреждённый блок PNG');const chunk=bytes.subarray(offset+8,offset+8+length);if(crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))invalid('Неверная контрольная сумма PNG');
 if(!header&&type!=='IHDR')invalid('PNG без заголовка');if(type==='IHDR'){if(header||length!==13)invalid('Неверный заголовок PNG');header={width:chunk.readUInt32BE(0),height:chunk.readUInt32BE(4),depth:chunk[8],color:chunk[9],interlace:chunk[12]};if(chunk[10]||chunk[11]||header.interlace)invalid('Для эмодзи нужен PNG без interlace');if(header.width<1||header.height<1||header.width>512||header.height>512||exact&&(header.width!==100||header.height!==100))invalid('Холст эмодзи: 100×100 px');if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[header.color]||[]).includes(header.depth))invalid('Неподдерживаемый формат пикселей');}
 else if(type==='acTL'||type==='fcTL'||type==='fdAT')invalid('Анимированный PNG не поддерживается в MVP');
 else if(type==='PLTE'){if(seenData||length===0||length%3||length>768)invalid('Неверная палитра');palette=true;}
 else if(type==='IDAT'){seenData=true;data.push(chunk);}
 else if(type==='IEND'){if(length||!seenData)invalid('Неполный PNG');ended=true;offset+=12;break;}
 else if(type[0]===type[0].toUpperCase()&&type!=='tRNS')invalid('Неподдерживаемый обязательный блок PNG');
 offset+=length+12;}
 if(!ended||offset!==bytes.length||header.color===3&&!palette)invalid('Неполный PNG');const channels={0:1,2:3,3:1,4:2,6:4}[header.color],row=Math.ceil(header.width*channels*header.depth/8),expected=(row+1)*header.height;let decoded;try{decoded=inflateSync(Buffer.concat(data),{maxOutputLength:expected+1});}catch{invalid('PNG не декодируется');}if(decoded.length!==expected)invalid('Повреждённые пиксели PNG');for(let y=0;y<header.height;y++)if(decoded[y*(row+1)]>4)invalid('Неверный фильтр PNG');return {width:header.width,height:header.height,format:'png',is_animated:false,sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length};
}
