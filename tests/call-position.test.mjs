import test from 'node:test';
import assert from 'node:assert/strict';
import {clampCallPosition} from '../client/src/call-position.mjs';
test('minimized call remains reachable after dragging and viewport resize',()=>{
 assert.deepEqual(clampCallPosition({x:-50,y:800},{width:1000,height:700},{width:360,height:80}),{x:12,y:608});
 assert.deepEqual(clampCallPosition({x:1000,y:500},{width:390,height:500},{width:360,height:80}),{x:18,y:408});
 assert.deepEqual(clampCallPosition({x:100,y:100},{width:200,height:60},{width:360,height:80}),{x:0,y:0});
});
