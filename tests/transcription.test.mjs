import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
import {createTranscriber} from '../server/transcription.mjs';

test('server transcription stores once, is chat-authorized and returns text in message history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'volna-transcription-'));let calls=0,received;
 const app=createApp({database:join(dir,'db'),uploads:join(dir,'uploads'),transcriber:async input=>{calls++;received=input;return 'Привет, это проверка.';}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(path,token,data)=>{const res=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:res.status,data:await res.json()};};
 try{
  const alice=(await call('/register','',{username:'alice',password:'long-password'})).data,bob=(await call('/register','',{username:'bob',password:'long-password'})).data,eve=(await call('/register','',{username:'eve',password:'long-password'})).data;
  const chat=(await call('/chats',alice.token,{user_id:bob.user.id})).data.id;
  const upload=await fetch(base+'/uploads',{method:'POST',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'audio/webm','X-File-Name':encodeURIComponent('Голосовое-sample.webm')},body:Buffer.from('fake audio bytes')});assert.equal(upload.status,201);const file=await upload.json();
  const sent=await call(`/chats/${chat}/messages`,alice.token,{attachment_id:file.id,client_id:randomUUID()});assert.equal(sent.status,201);
  assert.equal((await call(`/messages/${sent.data.id}/transcribe`,eve.token,{})).status,404);
  const result=await call(`/messages/${sent.data.id}/transcribe`,bob.token,{});assert.equal(result.status,200);assert.equal(result.data.transcript,'Привет, это проверка.');
  assert.equal(calls,1);assert.deepEqual(received.bytes,Buffer.from('fake audio bytes'));assert.equal(received.mime,'audio/webm');
  assert.equal((await call(`/messages/${sent.data.id}/transcribe`,alice.token,{})).data.transcript,result.data.transcript);assert.equal(calls,1);
  assert.equal((await call(`/chats/${chat}/messages`,bob.token)).data[0].transcript,result.data.transcript);
  assert.equal((await call(`/messages/${sent.data.id}/delete`,alice.token,{})).status,200);
  assert.equal((await call(`/messages/${sent.data.id}`,bob.token)).data.transcript,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('transcriber sends audio only to the private Whisper service, without a paid API key',async()=>{
 let request;
 const transcribe=createTranscriber({fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({text:' Распознано. '}),{status:200,headers:{'Content-Type':'application/json'}});}});
 assert.equal(await transcribe({bytes:Buffer.from('voice'),name:'Голосовое.webm',mime:'audio/webm'}),'Распознано.');
 assert.equal(request.url,'http://transcription:8000/transcribe');assert.equal(request.options.headers,undefined);
 const form=request.options.body;assert.equal(form.get('file').type,'audio/webm');assert.equal(form.get('file').name,'Голосовое.webm');assert.equal(await form.get('file').text(),'voice');
});

test('transcriber reports local Whisper service errors without exposing internals',async()=>{
 const transcribe=createTranscriber({fetchImpl:async()=>new Response('{}',{status:503})});
 await assert.rejects(transcribe({bytes:Buffer.from('x'),name:'voice.webm',mime:'audio/webm'}),error=>error.status===503&&/модель распознавания ещё загружается/.test(error.message));
 const failed=createTranscriber({fetchImpl:async()=>new Response(JSON.stringify({detail:{state:'failed',error:{type:'OSError',private:'secret'}}}),{status:503})});
 await assert.rejects(failed({bytes:Buffer.from('x'),mime:'audio/webm'}),error=>error.status===503&&/временно недоступно/.test(error.message)&&!/secret|OSError/.test(error.message));
});

test('transcription distinguishes silent audio and invalid recordings from service outages',async()=>{
 for(const [status,phrase] of [[422,'не удалось распознать речь'],[415,'формат аудио'],[413,'слишком большая'],[400,'повреждена']]){
  let calls=0;const transcribe=createTranscriber({fetchImpl:async()=>{calls++;return new Response('{"detail":"private"}',{status});},wait:async()=>{}});
  await assert.rejects(transcribe({bytes:Buffer.from('x')}),e=>e.status===status&&e.message.includes(phrase)&&!e.message.includes('private'));assert.equal(calls,1);
 }
});
test('transcription retries a transient service or connection failure once and bounds retries',async()=>{
 for(const first of [()=>new Response('{}',{status:502}),()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});}]){
  let calls=0,pauses=0;const transcribe=createTranscriber({fetchImpl:async()=>++calls===1?first():new Response('{"text":"Работает"}'),wait:async()=>{pauses++;}});
  assert.equal(await transcribe({bytes:Buffer.from('x')}),'Работает');assert.equal(calls,2);assert.equal(pauses,1);
 }
 let calls=0;const transcribe=createTranscriber({fetchImpl:async()=>{calls++;return new Response('{}',{status:500});},wait:async()=>{}});
 await assert.rejects(transcribe({bytes:Buffer.from('x')}),e=>e.status===502);assert.equal(calls,2);
});
