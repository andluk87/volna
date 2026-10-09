// QR Model 2, byte mode, version 5 / level L / mask 0. One RS block: 108 + 26 bytes.
// Fixed configuration is sufficient for Volna's 57-byte, server-issued login payload.
export function qrMatrix(text){
 const bytes=new TextEncoder().encode(text);if(bytes.length>106)throw Error('QR payload too long');
 const bits=[];const push=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push((v>>>i)&1);};
 push(4,4);push(bytes.length,8);bytes.forEach(b=>push(b,8));push(0,Math.min(4,864-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));
 while(data.length<108)data.push(data.length%2===(Math.ceil(bits.length/8)%2)?0xec:0x11);
 const exp=[],log=[];let v=1;for(let i=0;i<255;i++){exp[i]=v;log[v]=i;v<<=1;if(v&256)v^=0x11d;}for(let i=255;i<510;i++)exp[i]=exp[i-255];
 const mul=(a,b)=>a&&b?exp[log[a]+log[b]]:0;let generator=[1];
 for(let i=0;i<26;i++){const next=Array(generator.length+1).fill(0);generator.forEach((g,j)=>{next[j]^=g;next[j+1]^=mul(g,exp[i]);});generator=next;}
 const remainder=[...data,...Array(26).fill(0)];for(let i=0;i<data.length;i++){const factor=remainder[i];for(let j=0;j<generator.length;j++)remainder[i+j]^=mul(generator[j],factor);}
 const encoded=[...data,...remainder.slice(-26)],stream=[];encoded.forEach(b=>{for(let i=7;i>=0;i--)stream.push((b>>>i)&1);});
 const n=37,grid=Array.from({length:n},()=>Array(n).fill(null));const set=(x,y,d)=>{if(x>=0&&y>=0&&x<n&&y<n)grid[y][x]=!!d;};
 const finder=(x,y)=>{for(let j=-1;j<=7;j++)for(let i=-1;i<=7;i++)set(x+i,y+j,i>=0&&i<=6&&j>=0&&j<=6&&(i===0||i===6||j===0||j===6||i>=2&&i<=4&&j>=2&&j<=4));};
 finder(0,0);finder(n-7,0);finder(0,n-7);
 for(let i=8;i<n-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}
 for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)set(30+x,30+y,Math.max(Math.abs(x),Math.abs(y))===2||x===0&&y===0);
 let format=8,rem=format;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);format=((format<<10)|rem)^0x5412;
 const fb=i=>((format>>>i)&1)!==0;
 for(let i=0;i<=5;i++)set(8,i,fb(i));set(8,7,fb(6));set(8,8,fb(7));set(7,8,fb(8));for(let i=9;i<15;i++)set(14-i,8,fb(i));
 for(let i=0;i<8;i++)set(n-1-i,8,fb(i));for(let i=8;i<15;i++)set(8,n-15+i,fb(i));set(8,n-8,true);
 let index=0,up=true;for(let right=n-1;right>=1;right-=2){if(right===6)right--;for(let t=0;t<n;t++){const y=up?n-1-t:t;for(let dx=0;dx<2;dx++){const x=right-dx;if(grid[y][x]===null)grid[y][x]=!!((stream[index++]||0)^((x+y)%2===0?1:0));}}up=!up;}
 return grid;
}
export function qrSvgPath(text){return qrMatrix(text).flatMap((row,y)=>row.flatMap((v,x)=>v?[`M${x+4},${y+4}h1v1h-1z`]:[])).join('');}
