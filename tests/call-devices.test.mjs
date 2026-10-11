import test from 'node:test';
import assert from 'node:assert/strict';
import {callDevices,microphoneConstraints,cameraConstraints} from '../client/src/call-devices.mjs';
test('separate call devices do not change recording devices; legacy preferences remain shared',()=>{
 let stored={microphone:'voice-mic',camera:'general-camera',output:'speakers',useSame:false,callMicrophone:'call-mic',callCamera:'call-camera',callOutput:'headset'};
 const previous=globalThis.localStorage;globalThis.localStorage={getItem:()=>JSON.stringify(stored)};
 try{
  assert.equal(microphoneConstraints().deviceId.exact,'voice-mic');assert.equal(microphoneConstraints(true).deviceId.exact,'call-mic');assert.equal(cameraConstraints(true,true).deviceId.exact,'call-camera');assert.equal(callDevices(true).output,'headset');
  delete stored.useSame;assert.equal(callDevices(true).output,'speakers');assert.equal(microphoneConstraints(true).deviceId.exact,'voice-mic');
 }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
