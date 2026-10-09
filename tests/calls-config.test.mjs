import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const script=new URL('../scripts/calls-config.py',import.meta.url);
function inspect(environment){return spawnSync('python3',[script.pathname],{encoding:'utf8',input:JSON.stringify({services:{server:{environment}}})});}
test('TURN configuration follows resolved Compose values and never prints a shared secret',()=>{
  let result=inspect({TURN_HOST:'',TURN_SECRET:''});assert.equal(result.status,0);assert.equal(result.stdout,'0\n');
  const secret='abcd'.repeat(16);
  result=inspect({TURN_HOST:'turn.example.com',TURN_SECRET:secret});assert.equal(result.status,0);assert.equal(result.stdout,'1\n');assert.equal((result.stdout+result.stderr).includes(secret),false);
  for(const environment of [{TURN_HOST:'turn.example.com',TURN_SECRET:''},{TURN_HOST:'',TURN_SECRET:secret},{TURN_HOST:'https://turn.example.com/',TURN_SECRET:secret},{TURN_HOST:'turn.example.com',TURN_SECRET:'not-a-coturn-secret'}]){
    result=inspect(environment);assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(secret),false);
  }
  result=spawnSync('python3',[script.pathname],{encoding:'utf8',input:'invalid JSON'});assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/Traceback/);
});
