import {test} from 'node:test';
import assert from 'node:assert/strict';
import {columnLayout} from '../client/src/column-layout.mjs';
test('panels dock only when the actual resized columns fit',()=>{
 assert.equal(columnLayout(1360,true,392).dockEmoji,true);
 assert.equal(columnLayout(1360,true,600).dockEmoji,false);
 assert.equal(columnLayout(1480,false,360).dockInfo,true);
 assert.equal(columnLayout(1480,false,480).dockInfo,false);
 assert.equal(columnLayout(1000,false,480).sidebar,480);
 assert.equal(columnLayout(900,false,480).sidebar,480);
 assert.equal(columnLayout(800,false,480).sidebar,392);
});
test('saved widths are clamped and mobile uses the screen width',()=>{
 assert.equal(columnLayout(1436,true,99999).sidebar,600);
 assert.equal(columnLayout(1436,false,-1).sidebar,320);
 assert.equal(columnLayout(390,false,480).sidebar,390);
 assert.equal(columnLayout(700,true,392).mobile,true);
 assert.equal(columnLayout(700,false,360).mobile,false);
});
