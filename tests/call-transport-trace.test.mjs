import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticFields} from '../server/call-diagnostics.mjs';
test('timeout phases and InterruptedIOException are kept without raw network details',()=>{
 assert.deepEqual(diagnosticFields({stage:'start',error_type:'InterruptedIOException',transport_stage:'auth_refresh',elapsed_ms:15001,url:'PRIVATE',headers:'PRIVATE',address:'PRIVATE'}),{transport_stage:'auth_refresh',error_type:'InterruptedIOException',stage:'start',elapsed_ms:15001});
 assert.equal(diagnosticFields({transport_stage:'https://PRIVATE'}).transport_stage,undefined);
});
