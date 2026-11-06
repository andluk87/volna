import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {callRequestBudget} from '../server/call-request-budget.mjs';
test('only authenticated call polling, diagnostics and signaling receive a separate bounded budget',()=>{
 assert.equal(callRequestBudget('/api/calls/history','GET'),null);assert.equal(callRequestBudget('/api/chats','GET'),null);
 assert.equal(callRequestBudget('/api/calls/current','POST'),null);assert.equal(callRequestBudget('/api/calls/'+ 'a'.repeat(32)+'/end','POST').bucket,'signaling');
});
test('three devices polling do not exhaust account messaging; a noisy session cannot block another session or signaling',async t=>{
 const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const r=await fixtureFetch(base+'/register',{method:'POST',body:JSON.stringify({username:'budget-caller'})}),account=await r.json();
 const tokens=[account.token,'budget-device-two','budget-device-three'];for(const token of tokens.slice(1))app.db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),account.user.id,Date.now()+3600000);
 const get=(path,token=account.token)=>fetch(base+path,{headers:{Authorization:'Bearer '+token}});
 const poll='/calls/current?device='+'a'.repeat(32);
 for(const token of tokens)for(let i=0;i<100;i++)assert.equal((await get(poll,token)).status,200);
 assert.equal((await get('/chats')).status,200);
 for(let i=0;i<80;i++)assert.equal((await get(poll)).status,200);
 assert.equal((await get(poll)).status,429);assert.equal((await get('/calls/current?device='+'b'.repeat(32))).status,200,'another window of the same session is independent');assert.equal((await get(poll,tokens[1])).status,200);assert.equal((await get('/calls/config')).status,200);assert.equal((await get('/chats')).status,200);
});
