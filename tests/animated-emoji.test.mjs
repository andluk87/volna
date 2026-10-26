import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isEmoji} from '../shared/emoji-text.mjs';
const root=new URL('../client/public/site/animated-emoji/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const index=JSON.parse(readFileSync(new URL('../client/src/animated-emoji-index.json',import.meta.url)));
test('vendored animations match the pinned source hashes and are self-contained 60fps Lottie',()=>{
 assert.equal(manifest.animations.length,599);
 assert.equal(Object.keys(index).length,580);
 for(const item of manifest.animations){
  const bytes=readFileSync(new URL(item.file,root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.file);
  const data=JSON.parse(gunzipSync(bytes));
  assert.equal(data.fr,60,item.file);
  assert.ok(data.op>data.ip&&data.w>0&&data.h>0,item.file);
  assert.ok(data.layers.length>0,item.file);
  assert.ok(!data.assets?.some(a=>a.p),item.file);
 }
 for(const [emoji,file] of Object.entries(index)){
  assert.ok(isEmoji(emoji),emoji);
  assert.ok(manifest.animations.some(a=>a.file===file&&a.unicode===emoji),emoji);
 }
 assert.equal(index['❤'],'tg_emoji_001.tgs');
 assert.equal(index['🥳'],'tg_emoji_004.tgs');
});
