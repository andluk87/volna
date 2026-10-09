import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterChats,adjacentMessage,dateLabel,mediaKind} from '../client/src/chat-layout.mjs';
import {normalizeAppearance} from '../client/src/appearance.mjs';
import {resetDemo,demoRequest,demoEvents,demoUpload} from '../client/src/demo-api.mjs';
import {parseInline} from '../client/src/message-format.mjs';
test('nginx profile regex is quoted and build validates config without Compose DNS',()=>{
 const s=readFileSync(new URL('../docker/nginx.conf',import.meta.url),'utf8');
 const directive=s.match(/location\s+~\s+([^\n]+)\s*\{/)[1].trim();assert.ok(directive.startsWith('"')&&directive.endsWith('"'),'a quantified regex must be one quoted nginx argument');const pattern=directive.slice(1,-1),r=new RegExp(pattern);assert.ok(r.test('/nick/'));assert.ok(!r.test('/nic/'));assert.ok(!r.test('/'+'a'.repeat(33)+'/'));assert.ok(!r.test('/api/auth/'));
 const docker=readFileSync(new URL('../docker/web.Dockerfile',import.meta.url),'utf8');assert.ok(docker.includes('nginx -t'));assert.ok(docker.includes('http://127.0.0.1:3000'));assert.ok(docker.includes('mv /tmp/volna-runtime.conf /etc/nginx/conf.d/default.conf'));
});
test('chat folders isolate archive/topics, sort pins and search case-insensitively',()=>{
 const chats=[{id:1,name:'Анна',kind:'direct',last_at:'2026-10-08',unread:2},{id:2,name:'Команда',kind:'group',pinned:1,last_at:'2026-10-01'},{id:3,name:'Канал',kind:'channel',archived:1},{id:4,name:'Подтема',kind:'group',parent_id:2}];
 assert.deepEqual(filterChats(chats).map(c=>c.id),[2,1]);assert.deepEqual(filterChats(chats,'direct').map(c=>c.id),[1]);assert.deepEqual(filterChats(chats,'unread').map(c=>c.id),[1]);assert.deepEqual(filterChats(chats,'archived').map(c=>c.id),[3]);assert.deepEqual(filterChats(chats,'all','АННА').map(c=>c.id),[1]);assert.deepEqual(filterChats(chats,'all','Канал').map(c=>c.id),[3]);
});
test('message grouping, local day labels, media tabs and safe underline formatting',()=>{
 const a={sender_id:1,created_at:'2026-10-08T12:00:00Z'},b={sender_id:1,created_at:'2026-10-08T12:03:00Z'};assert.equal(adjacentMessage(a,b),true);assert.equal(adjacentMessage(a,{...b,sender_id:2}),false);assert.equal(adjacentMessage(a,{...b,reply:{id:1}}),false);assert.equal(adjacentMessage(a,{...b,created_at:'2026-10-08T13:00:00Z'}),false);assert.equal(dateLabel(new Date(2026,9,8),new Date(2026,9,8,12)),'Сегодня');assert.equal(dateLabel(new Date(2026,9,7),new Date(2026,9,8,12)),'Вчера');assert.equal(mediaKind({attachment:{mime:'audio/webm'}}),'voice');assert.equal(mediaKind({text:'https://volna.lknet.ru'}),'links');assert.deepEqual(parseInline('__Волна__'),[{type:'underline',text:'Волна'}]);assert.equal(parseInline('<script>alert(1)</script>')[0].type,'text');
 const settings=normalizeAppearance({background:'javascript:alert(1)',backgroundColor:'red;',animations:false});assert.equal(settings.background,'pattern');assert.equal(settings.backgroundColor,'#dfe9dc');assert.equal(settings.animations,false);
});
test('isolated demo provides all formats, local edits/receipts/archive/search/reactions/forwarding and idempotent send',async()=>{
 const state=resetDemo();assert.equal(state.chats.length,24);assert.equal(state.messages.length,288);assert.ok(state.users.length>=10);assert.ok(state.messages.some(m=>m.expression?.kind==='gif'));assert.ok(state.messages.some(m=>m.attachment?.mime.startsWith('video/')));
 const controller=new AbortController(),events=[];const eventLoop=demoEvents(controller.signal,e=>events.push(e),()=>{});
 const send={text:'Уникальный тест 🌊',client_id:'fixed-client-id-001'};const a=await demoRequest('/chats/1/messages',send,'POST');const b=await demoRequest('/chats/1/messages',send,'POST');assert.equal(a.id,b.id);assert.equal(state.messages.filter(m=>m.text===send.text).length,1);
 await demoRequest(`/messages/${a.id}/edit`,{text:'Тест изменён'},'POST');assert.equal((await demoRequest('/messages/'+a.id)).text,'Тест изменён');await demoRequest(`/messages/${a.id}/react`,{emoji:'👍',active:true},'POST');assert.equal((await demoRequest('/messages/'+a.id)).reactions.length,1);await demoRequest(`/messages/${a.id}/react`,{emoji:'👍',active:false},'POST');assert.equal((await demoRequest('/messages/'+a.id)).reactions.length,0);
 const forwarded=await demoRequest(`/messages/${a.id}/forward`,{chat_id:2,client_id:'forward-id-001'},'POST');assert.equal(forwarded.chat_id,2);assert.ok(forwarded.forwarded_name);await demoRequest('/chats/1/preferences',{archived:true,muted:true},'POST');assert.ok((await demoRequest('/chats')).find(c=>c.id===1).archived);await demoRequest('/chats/1/read',{},'POST');assert.equal((await demoRequest('/chats')).find(c=>c.id===1).unread,0);
 const results=await demoRequest('/search/messages?q='+encodeURIComponent('Тест изменён'));assert.ok(results.some(m=>m.id===a.id));const photos=await demoRequest('/chats/1/media?type=media');assert.ok(photos.every(m=>/^(image|video)\//.test(m.attachment.mime)));const links=await demoRequest('/chats/1/media?type=links');assert.ok(links.every(m=>/https?:\/\//.test(m.text)));
 const file=await demoUpload(new File(['hello'],'note.txt',{type:'text/plain'}));const attached=await demoRequest('/chats/1/messages',{text:'Подпись',attachment_id:file.id,client_id:'attachment-id-001'},'POST');assert.equal(attached.attachment.name,'note.txt');const voice=state.messages.find(m=>m.attachment?.mime.startsWith('audio/'));assert.ok((await demoRequest(`/messages/${voice.id}/transcribe`,{},'POST')).transcript);
 await demoRequest(`/messages/${a.id}/delete`,{},'POST');assert.ok((await demoRequest('/messages/'+a.id)).deleted_at);await new Promise(r=>setTimeout(r,0));assert.ok(events.some(e=>e.type==='message'));controller.abort();await eventLoop;
 resetDemo();assert.equal((await demoRequest('/chats/1/messages')).length,12);
});
