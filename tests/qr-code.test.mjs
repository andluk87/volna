import test from 'node:test';import assert from 'node:assert/strict';import {qrMatrix,qrSvgPath} from '../client/src/qr-code.mjs';
test('QR login payload round trips through byte mode with valid Reed Solomon syndromes',()=>{
 const text='volna://login/'+'a'.repeat(43),m=qrMatrix(text),n=37;
 assert.equal(m.length,n);assert.ok(m.every(row=>row.length===n&&row.every(v=>typeof v==='boolean')));
 const reserved=(x,y)=>(x<=8&&y<=8)||(x>=29&&y<=8)||(x<=8&&y>=29)||x===6||y===6||(x>=28&&x<=32&&y>=28&&y<=32);
 const bits=[];let upward=true;for(let r=36;r>=1;r-=2){if(r===6)r--;for(let i=0;i<37;i++){const y=upward?36-i:i;for(let d=0;d<2;d++){const x=r-d;if(!reserved(x,y))bits.push(Number(m[y][x])^Number((x+y)%2===0));}}upward=!upward;}
 assert.equal(bits.slice(0,4).join(''),'0100');const value=(a,b)=>bits.slice(a,b).reduce((v,b)=>v*2+b,0);assert.equal(value(4,12),text.length);
 assert.equal(String.fromCharCode(...Array.from({length:text.length},(_,i)=>value(12+i*8,20+i*8))),text);
 const words=Array.from({length:134},(_,i)=>value(i*8,i*8+8));const mul=(a,b)=>{let result=0;while(b){if(b&1)result^=a;b>>=1;a<<=1;if(a&256)a^=285;}return result;};let root=1;for(let i=0;i<26;i++){assert.equal(words.reduce((acc,b)=>mul(acc,root)^b,0),0);root=mul(root,2);}
 assert.ok(qrSvgPath(text).startsWith('M4,4'));assert.throws(()=>qrMatrix('a'.repeat(107)),/long/);
});
