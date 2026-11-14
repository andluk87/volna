const {deflateSync}=require('node:zlib');
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([kind,data])));return Buffer.concat([size,kind,data,sum]);}
function monochromeTray(dark){const size=24,raw=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)for(let x=2;x<22;x++){const wave=2*Math.sin((x-2)/20*Math.PI*3);if(Math.abs(y-8-wave)<1.1||Math.abs(y-15-wave)<1.1)raw.set(dark?[240,240,240,255]:[55,65,75,255],y*(size*4+1)+1+x*4);}const h=Buffer.alloc(13);h.writeUInt32BE(size,0);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
module.exports={monochromeTray};
