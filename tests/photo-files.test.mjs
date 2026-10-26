import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {albumRows,albumCellStyle} from '../client/src/media-album.mjs';
const {photoPayload}=createRequire(import.meta.url)('../client/electron/photo-files.cjs');
test('Windows save only accepts image bytes and generates a safe image filename',()=>{const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,0]);const value=photoPayload({bytes,mime:'image/png',name:'../../file.exe'});assert.equal(value.name,'file.png');assert.equal(value.bytes.length,9);assert.throws(()=>photoPayload({bytes,mime:'image/jpeg'}));assert.throws(()=>photoPayload({bytes:new Uint8Array([1,2,3]),mime:'image/png'}));assert.throws(()=>photoPayload({bytes:new Uint8Array(21*1024*1024),mime:'image/png'}));});
test('four-photo album has one hero and three equal thumbnails',()=>{assert.deepEqual(albumRows(4),[1,3]);assert.equal(albumCellStyle(4,0).gridColumn,'span 12');for(let i=1;i<4;i++)assert.equal(albumCellStyle(4,i).gridColumn,'span 4');});
