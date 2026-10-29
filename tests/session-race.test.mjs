import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
const {createSessionStore,createSessionRefresh}=createRequire(import.meta.url)('../client/electron/session-store.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(t){
 const dir=mkdtempSync(path.join(tmpdir(),'volna-session-race-')),app=createApp({database:':memory:',uploads:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,rawFetch=globalThis.fetch;
 const login=await(await fixtureFetch(base+'/api/register',{method:'POST',body:JSON.stringify({username:'racesession',name:'Fixture'})})).json();
 const store=createSessionStore({file:path.join(dir,'accounts.dat'),legacyFile:path.join(dir,'legacy.dat'),secure:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}});
 let refreshCount=0;const native=createSessionRefresh({store,request:async(refresh_token,account_id)=>{refreshCount++;const r=await rawFetch(base+'/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token,account_id})});return {status:r.status,...(r.ok?{session:await r.json()}:{})};}});
 const before={window:globalThis.window,sessionStorage:globalThis.sessionStorage,localStorage:globalThis.localStorage,location:globalThis.location};
 const bridge={saveAccounts:async value=>store.save(value),refreshSession:async value=>native.refresh(value)};
 globalThis.window={volnaDesktop:bridge};globalThis.sessionStorage=globalThis.localStorage={removeItem(){}};globalThis.location={search:''};
 let intercept;globalThis.fetch=async(url,options)=>{const invoke=()=>rawFetch(String(url).startsWith('http')?url:base+url,options);return intercept?intercept(url,options,invoke):invoke();};
 const vite=await createServer({root:path.resolve('client'),server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 t.after(async()=>{globalThis.fetch=rawFetch;Object.assign(globalThis,before);await vite.close();await app.close();rmSync(dir,{recursive:true,force:true});});
 const session=await vite.ssrLoadModule('/src/session.mjs');await session.saveSession(login);
 return {app,base,login,store,native,bridge,session,rawFetch,refreshCount:()=>refreshCount,intercept:fn=>intercept=fn};
}
test('late parallel 401s after idle refresh once and both requests succeed against the real API',{timeout:15000},async t=>{
 const f=await setup(t),firstRetry=deferred(),secondRetry=deferred();
 f.intercept(async(url,options,invoke)=>{const first=String(url).includes('one'),sent=new Headers(options.headers).get('Authorization')?.slice(7);if(sent===f.login.token){if(!first)await firstRetry.promise;return new Response('{}',{status:401});}if(first){firstRetry.resolve();await secondRetry.promise;}else secondRetry.resolve();return invoke();});
 const responses=await Promise.all(['one','two','three','four','five'].map(name=>f.session.sessionFetch('/api/me?'+name,{headers:{Authorization:'Bearer '+f.login.token}})));
 assert.deepEqual(responses.map(r=>r.status),[200,200,200,200,200]);assert.equal(f.refreshCount(),1);assert.equal(f.session.accountSessions().length,1);assert.equal(f.store.load().accounts.length,1);
});
test('a stale refresh request reuses current credentials but does not leave refresh locked',async t=>{
 const f=await setup(t);const next=await f.session.refreshAccount(f.login.user.id,true);assert.equal(f.refreshCount(),1);
 const stale=await f.session.refreshAccount(f.login.user.id,true,false,f.login.token);assert.equal(stale.token,next.token);assert.equal(f.refreshCount(),1);
 await f.session.refreshAccount(f.login.user.id,true,false,next.token);assert.equal(f.refreshCount(),2);
});
test('a second rotation during retry is recovered without logging the user out',async t=>{
 const f=await setup(t);let rotated=false;
 f.intercept(async(url,options,invoke)=>{const sent=new Headers(options.headers).get('Authorization')?.slice(7);if(sent===f.login.token)return new Response('{}',{status:401});if(!rotated){rotated=true;await f.session.refreshAccount(f.login.user.id,true,false,sent);}return invoke();});
 const response=await f.session.sessionFetch('/api/me',{headers:{Authorization:'Bearer '+f.login.token}});assert.equal(response.status,200);assert.equal(f.refreshCount(),2);assert.equal(f.session.accountSessions().length,1);
});
test('real revoked refresh credentials still end the session',async t=>{
 const f=await setup(t);f.app.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.login.user.id);f.app.db.prepare('DELETE FROM refresh_sessions WHERE user_id=?').run(f.login.user.id);
 const response=await f.session.sessionFetch('/api/me',{headers:{Authorization:'Bearer '+f.login.token}});assert.equal(response.status,401);assert.equal(f.session.accountSessions().length,0);assert.equal(f.store.load().accounts.length,0);
});
test('network outage during refresh preserves saved and in-memory accounts',async t=>{
 const f=await setup(t);f.intercept(async()=>new Response('{}',{status:401}));f.bridge.refreshSession=async()=>({status:503});await assert.rejects(f.session.sessionFetch('/api/me',{headers:{Authorization:'Bearer '+f.login.token}}),/обновить сеанс/);assert.equal(f.session.accountSessions().length,1);assert.equal(f.store.load().accounts.length,1);
});
test('bounded retry exhaustion is retryable and never erases the saved account',async t=>{
 const f=await setup(t);f.intercept(async()=>new Response('{}',{status:401}));await assert.rejects(f.session.sessionFetch('/api/me',{headers:{Authorization:'Bearer '+f.login.token}}),e=>e.status===503&&e.code==='SESSION_RETRY_REQUIRED');assert.equal(f.refreshCount(),4);assert.equal(f.session.accountSessions().length,1);assert.equal(f.store.load().accounts.length,1);
});
test('explicit logout while refresh is in flight cannot resurrect the account',async t=>{
 const f=await setup(t),start=deferred(),release=deferred(),native=f.bridge.refreshSession;f.bridge.refreshSession=async value=>{const result=await native(value);start.resolve();await release.promise;return result;};
 const pending=f.session.refreshAccount(f.login.user.id,true);await start.promise;f.session.clearStoredSession();await new Promise(r=>setImmediate(r));release.resolve();assert.equal(await pending,null);assert.equal(f.session.accountSessions().length,0);assert.equal(f.store.load().accounts.length,0);
});

test('a quiet refresh caller cannot turn a shared network failure into logout for an API caller',async t=>{
 const f=await setup(t),start=deferred(),release=deferred();f.bridge.refreshSession=async()=>{start.resolve();await release.promise;return {status:503};};
 const quiet=f.session.refreshAccount(f.login.user.id,false);await start.promise;
 const strict=f.session.refreshAccount(f.login.user.id,true);const rejected=assert.rejects(strict,/обновить сеанс/);release.resolve();assert.equal(await quiet,null);await rejected;assert.equal(f.session.accountSessions().length,1);
});

test('an aborted request does not retry or turn shared refresh into a logout',async t=>{
 const f=await setup(t),start=deferred(),release=deferred(),native=f.bridge.refreshSession,controller=new AbortController();f.intercept(async()=>new Response('{}',{status:401}));f.bridge.refreshSession=async value=>{const result=await native(value);start.resolve();await release.promise;return result;};
 const pending=f.session.sessionFetch('/api/me',{headers:{Authorization:'Bearer '+f.login.token},signal:controller.signal});const rejected=assert.rejects(pending,e=>e.name==='AbortError');await start.promise;controller.abort();release.resolve();await rejected;assert.equal(f.refreshCount(),1);assert.equal(f.session.accountSessions().length,1);assert.equal(f.store.load().accounts.length,1);
});

test('upload progress transport keeps the original account and refreshes its expired token',async t=>{
 const f=await setup(t),sent=[];
 const transport=async(url,options)=>{const value=new Headers(options.headers).get('Authorization');sent.push(value);return new Response('{}',{status:value==='Bearer '+f.login.token?401:201});};
 const response=await f.session.sessionFetch('/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+f.login.token},body:new Uint8Array([1,2,3])},transport);
 assert.equal(response.status,201);assert.equal(sent.length,2);assert.notEqual(sent[0],sent[1]);assert.equal(f.refreshCount(),1);assert.equal(f.session.accountSessions()[0].user.id,f.login.user.id);
});
