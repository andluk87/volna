import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
test('aborting a partial upload creates no attachment or message, releases capacity and does not log a server failure',async t=>{
 const directory=await mkdtemp(os.tmpdir()+'/volna-upload-cancel-'),app=createApp({database:':memory:',uploads:directory});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const session=await(await fixtureFetch(base+'/api/register',{method:'POST',body:JSON.stringify({username:'uploadcancel'})})).json();const original=console.error,errors=[];console.error=(...args)=>errors.push(args);
 t.after(async()=>{console.error=original;await app.close();await rm(directory,{recursive:true,force:true});});
 for(let i=0;i<5;i++){
  const request=http.request(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/octet-stream','X-File-Name':'cancel.bin','Content-Length':1024*1024}});request.on('error',()=>{});
  request.write(Buffer.alloc(8192));await once(request,'socket');await new Promise(resolve=>setTimeout(resolve,20));request.destroy();await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM attachments').get().n,0);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);assert.deepEqual(await readdir(directory),[]);assert.deepEqual(errors,[]);
 const response=await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/octet-stream','X-File-Name':'success.bin'},body:Buffer.alloc(8192)});assert.equal(response.status,201);assert.equal((await response.json()).size,8192);
});
