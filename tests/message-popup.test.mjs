import test from 'node:test';
import assert from 'node:assert/strict';
import {fitMessagePopup,messageMenuContains} from '../client/src/message-popup.mjs';
test('message menus stay inside the chat column and viewport at all edges and sizes',()=>{
 for(const [vw,vh] of [[390,500],[760,500],[1000,800],[1600,900],[240,180]]){
  const bounds={left:vw>760?392:0,right:vw};
  for(const x of [bounds.left+1,(bounds.left+vw)/2,vw-1])for(const y of [1,vh/2,vh-1])for(const width of [268,320])for(const height of [320,400,900]){
   const p=fitMessagePopup({x,y,width,height,viewportWidth:vw,viewportHeight:vh,bounds});
   assert.ok(p.left>=bounds.left+8-0.01);assert.ok(p.left+p.width<=vw-8+0.01);
   assert.ok(p.top>=8-0.01);assert.ok(p.top+Math.min(height,p.maxHeight)<=vh-8+0.01);
  }
 }
});
test('a portal belongs to its owner, but another message or outside click does not',()=>{
 const owner={dataset:{menuOwner:'one'},contains:()=>false};
 assert.equal(messageMenuContains(owner,{closest:()=>({dataset:{messageMenuOwner:'one'}})}),true);
 assert.equal(messageMenuContains(owner,{closest:()=>({dataset:{messageMenuOwner:'two'}})}),false);
 assert.equal(messageMenuContains(owner,{closest:()=>null}),false);
});

test('reaction catalog offers thousands of unique, server-compatible emoji and includes its data license',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');
 const {isEmoji}=await import('../shared/emoji-text.mjs');
 const data=JSON.parse(readFileSync(new URL('../client/src/reaction-emoji.json',import.meta.url)));
 assert.ok(data.entries.length>3900);assert.equal(new Set(data.entries.map(row=>row[0])).size,data.entries.length);
 assert.ok(data.entries.every(([emoji,name])=>isEmoji(emoji)&&name.length>0));
 assert.ok(data.entries.some(([emoji])=>emoji==='👀'));
 assert.ok(existsSync(new URL('../client/public'+data.license,import.meta.url)));
});
test('Windows overlay titlebar stays clear of a tall message menu',()=>{
 const result=fitMessagePopup({x:10,y:5,width:268,height:900,viewportWidth:1000,viewportHeight:500,viewportTop:28});
 assert.ok(result.top>=36);assert.ok(result.top+result.maxHeight<=492);
});
