import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicAddress,webhookUrl,resolveWebhook,egressOperation} from '../server/webhook-egress.mjs';
import {signature,secretBox} from '../server/bot-webhooks.mjs';
import {createHmac} from 'node:crypto';

test('webhook SSRF: canonical IPs, reserved ranges, mixed DNS and every new resolution',async()=>{
 for(const ip of ['0.0.0.0','10.1.1.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','192.0.0.1','192.88.99.1','198.18.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','64:ff9b::808:808','fc00::1','fe80::1','2001:db8::1','2001::1','2002:808:808::1','3ffe::1','3fff::1'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(ip),true,ip);
 for(const url of ['http://example.com','https://localhost','https://host.local/','https://user:pass@example.com/','https://example.com:8443/','https://example.com/#x','https://127.1','https://2130706433','https://0x7f000001','https://[::ffff:127.0.0.1]','https://example.com./','https://example.com\\@localhost/'])assert.throws(()=>webhookUrl(url),undefined,url);
 await assert.rejects(resolveWebhook('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
 let count=0;const dns=async()=>[{address:++count===1?'8.8.8.8':'127.0.0.1',family:4}];
 await resolveWebhook('https://example.com',dns);await assert.rejects(resolveWebhook('https://example.com',dns));
});

test('webhook pins validated IP while retaining TLS verification; redirects are never followed',async()=>{
 let calls=0;
 const input={op:'deliver',url:'https://example.com/events',body:'{"text":"Привет"}',event_id:'evt_123',timestamp:'1792200000',signature:'sha256='+'a'.repeat(64)};
 const request=(url,options,callback)=>{
  calls++;assert.equal(url.hostname,'example.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
  options.lookup('example.com',{},(err,ip,family)=>{assert.equal(err,null);assert.equal(ip,'8.8.8.8');assert.equal(family,4);});
  assert.equal(options.headers['Content-Length'],Buffer.byteLength(input.body));assert.equal(options.headers['X-Bot-Event-Id'],'evt_123');assert.equal(options.headers.Authorization,undefined);
  const req=new EventEmitter();req.destroy=()=>{};req.end=body=>{assert.equal(body,input.body);const res=new EventEmitter();res.statusCode=302;res.destroy=()=>{};callback(res);queueMicrotask(()=>res.emit('end'));};return req;
 };
 const r=await egressOperation(input,{resolver:async()=>[{address:'8.8.8.8',family:4}],request});assert.deepEqual(r,{ok:false,status:302});assert.equal(calls,1);
});

test('webhook total timeout also covers DNS and forbids late connection after timeout',async()=>{
 let connects=0;await assert.rejects(egressOperation({op:'deliver',url:'https://example.com'},{timeout:5,resolver:()=>new Promise(r=>setTimeout(()=>r([{address:'8.8.8.8',family:4}]),20)),request:()=>{connects++;}}),/TIMEOUT/);
 await new Promise(r=>setTimeout(r,30));assert.equal(connects,0);
});

test('webhook secrets use authenticated encryption and signature covers exact raw UTF8 body',()=>{
 const box=secretBox(Buffer.alloc(32,1)),secret='separate webhook credential',a=box.seal(secret),b=box.seal(secret);assert.notEqual(a,b);assert.ok(!a.includes(secret));assert.equal(box.open(a),secret);assert.throws(()=>secretBox(Buffer.alloc(32,2)).open(a));
 const bytes=Buffer.from(a,'base64');bytes[30]^=1;assert.throws(()=>box.open(bytes.toString('base64')));
 const raw='{"text":"Привет","n":1}',timestamp='1792200000';assert.equal(signature(secret,timestamp,raw),'sha256='+createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex'));assert.notEqual(signature(secret,timestamp,raw),signature(secret,timestamp,raw+' '));
});

test('real HTTPS webhook carries signed UTF8 bytes, retries non-2xx and bounds response bodies',async t=>{
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process'),https=await import('node:https');
 const dir=mkdtempSync(join(tmpdir(),'webhook-tls-')),key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=webhook.example.com','-addext','subjectAltName=DNS:webhook.example.com'],{stdio:'ignore'});
 let status=200,large=false;const received=[];
 const server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString('utf8');received.push({raw,headers:req.headers});res.writeHead(status);res.end(large?'x'.repeat(9000):'ok');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const secret='receiver-specific signing secret',input={op:'deliver',url:'https://webhook.example.com/events',body:'{"text":"Привет 👋"}',event_id:'evt_actual_tls',timestamp:'1792200000'};input.signature=signature(secret,input.timestamp,input.body);
 // Route the public test address to a local TLS fixture with its own trusted CA.
 // Production uses the pinned public lookup; its exact options are checked above.
 const options={resolver:async()=>[{address:'8.8.8.8',family:4}],request:(url,opts,cb)=>https.request(url,{...opts,port:server.address().port,ca:readFileSync(cert),lookup:(_host,o,done)=>o?.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4)},cb)};
 assert.deepEqual(await egressOperation(input,options),{ok:true,status:200});assert.equal(received[0].raw,input.body);assert.equal(received[0].headers['x-bot-signature'],signature(secret,received[0].headers['x-bot-timestamp'],received[0].raw));assert.equal(received[0].headers.authorization,undefined);
 status=500;assert.deepEqual(await egressOperation(input,options),{ok:false,status:500});assert.equal(received[1].headers['x-bot-event-id'],received[0].headers['x-bot-event-id']);
 large=true;await assert.rejects(egressOperation(input,options),/RESPONSE_TOO_LARGE/);
 const untrusted={...options,request:(url,opts,cb)=>https.request(url,{...opts,port:server.address().port,lookup:(_h,o,done)=>o?.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4)},cb)};
 await assert.rejects(egressOperation(input,untrusted),/self-signed|certificate/i);
});
