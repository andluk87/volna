import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardFiles} from '../client/src/clipboard-files.mjs';
test('paste extracts screenshot files once when browser exposes both files and items',()=>{
 const image=new File(['image bytes'],'screenshot.png',{type:'image/png'});
 assert.deepEqual(clipboardFiles({files:[image],items:[{kind:'file',getAsFile:()=>image}]}),[image]);
});
test('paste supports file items without a files list and ignores strings or unavailable files',()=>{
 const first=new File(['a'],'a.png',{type:'image/png'}),second=new File(['b'],'b.png',{type:'image/png'});
 assert.deepEqual(clipboardFiles({items:[{kind:'string',getAsFile:()=>{throw Error('not a file');}},{kind:'file',getAsFile:()=>first},{kind:'file',getAsFile:()=>null},{kind:'file',getAsFile:()=>second}]}),[first,second]);
 assert.deepEqual(clipboardFiles({files:[],items:[]}),[]);assert.deepEqual(clipboardFiles(null),[]);
});
