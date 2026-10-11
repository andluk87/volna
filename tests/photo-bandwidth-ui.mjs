import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const vite=await createServer({root:new URL('../client/',import.meta.url).pathname,server:{host:'127.0.0.1',port:5191,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5191/app?demo=1');
 const result=await page.evaluate(async()=>{
  const {preparePhoto}=await import('/src/prepare-photo.mjs');const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(2400,1800);let seed=42;for(let i=0;i<pixels.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);const original=new File([await new Promise(r=>canvas.toBlob(r,'image/png'))],'camera.png',{type:'image/png'}),file=await preparePhoto(original),rotated=await preparePhoto(original,90),bitmap=await createImageBitmap(file),turned=await createImageBitmap(rotated);const output={original:original.size,prepared:file.size,width:bitmap.width,height:bitmap.height,type:file.type,name:file.name,rotation:[turned.width,turned.height]};bitmap.close();turned.close();return output;
 });assert.equal(result.width,1600);assert.equal(result.height,1200);assert.deepEqual(result.rotation,[1200,1600]);assert.equal(result.type,'image/jpeg');assert.equal(result.name,'camera.jpg');assert.ok(result.prepared<result.original/5,'photo shrinks substantially before upload');console.log('PASS: bounded photo dimensions, rotation and JPEG preparation',JSON.stringify(result));
}finally{await browser.close();await vite.close();}
