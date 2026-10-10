import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,fixtureFetch as fetch} from './phone-fixture.mjs';
async function fixture(t){const app=createApp({database:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const req=async(path,token='',data)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};};
 const users=[];for(const username of ['contact_alice','contact_boris','contact_carol'])users.push((await req('/register','',{username,name:username,password:'long-test-password'})).data);
 return {app,req,users};}
const manual=(req,a,phone,name)=>req('/contacts/manual',a.token,{phone_numbers:[phone],phonebook_name:name});
test('contacts: owner isolation, aliases and stable identity survive username changes',async t=>{
 const {req,users:[a,b,c]}=await fixture(t);const added=await manual(req,a,b.user.phone,'Борис работа');assert.equal(added.status,200);assert.equal(added.data.linked_user_id,b.user.id);
 const row=added.data;assert.equal((await req(`/contacts/${row.contact_id}/name`,c.token,{version:row.version,custom_name:'Чужое'})).status,404);
 assert.equal((await req(`/contacts/${row.contact_id}/name`,a.token,{version:row.version,custom_name:'Инженер'})).status,200);
 await req('/users/me/username',b.token,{username:'boris_changed'});
 const a2=(await req('/login','',{username:'contact_alice',password:'long-test-password'})).data;
 const book=(await req('/contacts/book',a2.token)).data;assert.equal(book.contacts.length,1);assert.equal(book.contacts[0].user.id,b.user.id);assert.equal(book.contacts[0].user.username,'boris_changed');assert.equal(book.contacts[0].user.name,'Инженер');assert.equal(book.contacts[0].user.phone,undefined);
 assert.equal((await req(`/users/${b.user.id}`,c.token)).data.name,'contact_boris');
 const chat=(await req('/chats',a.token,{user_id:b.user.id})).data;
 assert.equal((await req('/chats',a.token)).data.find(x=>x.id===chat.id).name,'Инженер');
 assert.equal((await req('/users?q='+encodeURIComponent('Инженер'),a.token)).data[0].id,b.user.id);
});
test('contacts: discovery policies are enforced by exact phone search and import',async t=>{
 const {req,users:[a,b,c]}=await fixture(t);
 await req('/contacts/settings',b.token,{discovery:'nobody'});
 assert.deepEqual((await req('/users?q='+encodeURIComponent(b.user.phone),a.token)).data,[]);
 assert.equal((await manual(req,a,b.user.phone,'Борис')).data.user,null);
 await req('/contacts/settings',b.token,{discovery:'contacts'});
 assert.deepEqual((await req('/users?q='+encodeURIComponent(b.user.phone),a.token)).data,[]);
 await manual(req,b,a.user.phone,'Алиса');
 assert.equal((await req('/users?q='+encodeURIComponent(b.user.phone),a.token)).data[0].id,b.user.id);
 assert.deepEqual((await req('/users?q='+encodeURIComponent(b.user.phone),c.token)).data,[]);
 assert.deepEqual((await req('/users?q=%2B7999',a.token)).data,[]);
});
test('contacts: stale rename conflicts and phonebook refresh preserves custom names',async t=>{
 const {req,users:[a,b]}=await fixture(t);await req('/contacts/settings',a.token,{enabled:true});let book=(await req('/contacts/book',a.token)).data;
 const payload={device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[{source_id:'source1',phonebook_name:'Работа',phone_numbers:[b.user.phone]}],removed:[]};
 assert.equal((await req('/contacts/sync',a.token,payload)).status,200);
 book=(await req('/contacts/book',a.token)).data;const row=book.contacts[0];
 assert.equal((await req(`/contacts/${row.contact_id}/name`,a.token,{version:row.version,custom_name:'Личное имя'})).status,200);
 assert.equal((await req(`/contacts/${row.contact_id}/name`,a.token,{version:row.version,custom_name:'Устаревшее'})).status,409);
 assert.equal((await req('/contacts/sync',a.token,payload)).status,409);
 book=(await req('/contacts/book',a.token)).data;payload.base_version=book.version;payload.contacts[0].phonebook_name='Новое имя телефона';
 assert.equal((await req('/contacts/sync',a.token,payload)).status,200);
 book=(await req('/contacts/book',a.token)).data;assert.equal(book.contacts.length,1);assert.equal(book.contacts[0].custom_name,'Личное имя');assert.equal(book.contacts[0].phonebook_name,'Новое имя телефона');
 payload.base_version=book.version;assert.equal((await req('/contacts/sync',a.token,payload)).status,200);assert.equal((await req('/contacts/book',a.token)).data.version,book.version);
});
test('contacts: purge strips imported data and rejects stale devices even after enabling',async t=>{
 const {req,users:[a,b]}=await fixture(t);await req('/contacts/settings',a.token,{enabled:true});let book=(await req('/contacts/book',a.token)).data;
 const payload={device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[{source_id:'source1',phonebook_name:'Телефонное имя',phone_numbers:[b.user.phone]}],removed:[]};await req('/contacts/sync',a.token,payload);
 assert.equal((await req('/contacts/purge',a.token,{})).status,400);assert.equal((await req('/contacts/purge',a.token,{confirm:true})).status,200);
 book=(await req('/contacts/book',a.token)).data;assert.equal(book.enabled,false);assert.equal(book.contacts[0].deleted,true);assert.deepEqual(book.contacts[0].phone_numbers,[]);assert.equal(book.contacts[0].phonebook_name,'');
 await req('/contacts/settings',a.token,{enabled:true});payload.base_version=(await req('/contacts/book',a.token)).data.version;assert.equal((await req('/contacts/sync',a.token,payload)).status,409);
});
test('contacts: deleted sources produce tombstones without deleting chats; exact lookup is rate limited',async t=>{
 const {req,users:[a,b]}=await fixture(t);const chat=(await req('/chats',a.token,{user_id:b.user.id})).data;
 await req('/contacts/settings',a.token,{enabled:true});let book=(await req('/contacts/book',a.token)).data;
 await req('/contacts/sync',a.token,{device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[{source_id:'source1',phonebook_name:'Телефон',phone_numbers:[b.user.phone]}],removed:[]});
 book=(await req('/contacts/book',a.token)).data;await req('/contacts/sync',a.token,{device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[],removed:['source1']});
 assert.equal((await req('/contacts/book?since='+book.version,a.token)).data.contacts[0].deleted,true);assert.ok((await req('/chats',a.token)).data.some(x=>x.id===chat.id));
 for(let i=0;i<5;i++)assert.equal((await req('/users?q='+encodeURIComponent(b.user.phone),a.token)).status,200);
 assert.equal((await req('/users?q='+encodeURIComponent(b.user.phone),a.token)).status,429);
});
test('contacts: manual records survive purge, imported aliases retain identity and reset is idempotent',async t=>{
 const {req,users:[a,b,c]}=await fixture(t);
 const manualRow=(await manual(req,a,b.user.phone,'Ручной')).data;
 await req('/contacts/settings',a.token,{enabled:true});let book=(await req('/contacts/book',a.token)).data;
 await req('/contacts/sync',a.token,{device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[{source_id:'imported',phone_numbers:[c.user.phone],phonebook_name:'Телефон'}],removed:[]});
 book=(await req('/contacts/book',a.token)).data;let imported=book.contacts.find(x=>x.linked_user_id===c.user.id);
 const renamed=(await req(`/contacts/${imported.contact_id}/name`,a.token,{version:imported.version,custom_name:'Моё имя'})).data;
 assert.equal((await req(`/contacts/${imported.contact_id}/name`,a.token,{version:imported.version,custom_name:'Моё имя'})).data.version,renamed.version);
 await req('/contacts/purge',a.token,{confirm:true});book=(await req('/contacts/book',a.token)).data;
 assert.deepEqual(book.contacts.find(x=>x.contact_id===manualRow.contact_id).phone_numbers,[b.user.phone]);
 imported=book.contacts.find(x=>x.linked_user_id===c.user.id);assert.equal(imported.deleted,false);assert.equal(imported.custom_name,'Моё имя');assert.deepEqual(imported.phone_numbers,[]);assert.equal(imported.phonebook_name,'');
 const reset=(await req(`/contacts/${imported.contact_id}/name`,a.token,{version:imported.version,custom_name:''})).data;assert.equal(reset.user.name,'contact_carol');
});
test('contacts: hidden matches become visible only when discovery permits, without reimport',async t=>{
 const {req,users:[a,b]}=await fixture(t);await req('/contacts/settings',b.token,{discovery:'nobody'});const row=(await manual(req,a,b.user.phone,'Друг')).data;assert.equal(row.user,null);
 assert.equal((await req('/contacts/book',a.token)).data.contacts[0].linked_user_id,null);
 await req('/contacts/settings',b.token,{discovery:'everyone'});const book=(await req('/contacts/book',a.token)).data;assert.equal(book.contacts[0].contact_id,row.contact_id);assert.equal(book.contacts[0].linked_user_id,b.user.id);
});
test('contacts: unauthenticated requests denied, private presence and stable links require no exposed phone',async t=>{
 const {req,users:[a,b,c]}=await fixture(t);assert.equal((await req('/contacts/book')).status,401);assert.equal((await req('/contacts/sync','',{})).status,401);
 const row=(await req('/contacts/link',a.token,{user_id:b.user.id})).data;assert.deepEqual(row.phone_numbers,[]);assert.equal(row.linked_user_id,b.user.id);assert.equal((await req('/contacts/link',a.token,{user_id:b.user.id})).data.contact_id,row.contact_id);
 await req('/contacts/settings',b.token,{presence:'nobody'});const visible=(await req(`/users/${b.user.id}`,a.token)).data;assert.equal(visible.online,false);assert.equal(visible.phone,undefined);
 assert.equal((await req(`/contacts/${row.contact_id}/delete`,c.token,{version:row.version})).status,404);
});
test('contacts: duplicate phone sources share stable records and one device cannot remove another source',async t=>{
 const {req,users:[a,b]}=await fixture(t);await req('/contacts/settings',a.token,{enabled:true});let book=(await req('/contacts/book',a.token)).data;
 for(const dev of['android_device_0001','android_device_0002']){await req('/contacts/sync',a.token,{device_id:dev,epoch:book.epoch,base_version:book.version,contacts:[{source_id:'same',phone_numbers:[b.user.phone,b.user.phone],phonebook_name:'Друг'}],removed:[]});book=(await req('/contacts/book',a.token)).data;}
 assert.equal(book.contacts.length,1);assert.deepEqual(book.contacts[0].phone_numbers,[b.user.phone]);await req('/contacts/sync',a.token,{device_id:'android_device_0001',epoch:book.epoch,base_version:book.version,contacts:[],removed:['same']});assert.equal((await req('/contacts/book',a.token)).data.contacts[0].deleted,false);
});
test('contacts: verified phone change preserves identity, history and aliases without linking a recycled number',async t=>{
 const {app,req,users:[a,b,c]}=await fixture(t);const original=b.user.phone,newPhone='+79009998877';const contact=(await manual(req,a,original,'Друг')).data;
 const chat=(await req('/chats',a.token,{user_id:b.user.id})).data;
 const request=await req('/auth/phone/change/request',b.token,{phone:newPhone});assert.equal(request.status,200);const challenge=request.data.sms_session_id,code=app.testSent.get(challenge);
 assert.equal((await req('/auth/sms/verify','',{sms_session_id:challenge,code})).status,403);
 assert.equal((await req('/auth/phone/change/verify',c.token,{sms_session_id:challenge,code})).status,403);
 const verified=await req('/auth/phone/change/verify',b.token,{sms_session_id:challenge,code});assert.equal(verified.status,200);assert.equal(verified.data.user.id,b.user.id);assert.equal(verified.data.user.phone,newPhone);
 assert.deepEqual((await req('/users?q='+encodeURIComponent(original),a.token)).data,[]);assert.equal((await req('/users?q='+encodeURIComponent(newPhone),a.token)).data[0].id,b.user.id);
 const book=(await req('/contacts/book',a.token)).data;assert.equal(book.contacts[0].contact_id,contact.contact_id);assert.equal(book.contacts[0].user.id,b.user.id);assert.ok((await req('/chats',b.token)).data.some(x=>x.id===chat.id));
 // Simulate a new verified holder of the retired number. Existing private links stay on the old stable ID.
 app.db.prepare('UPDATE users SET phone=?,phone_verified_at=? WHERE id=?').run(original,Date.now(),c.user.id);
 assert.equal((await req('/users?q='+encodeURIComponent(original),a.token)).data[0].id,c.user.id);assert.equal((await req('/contacts/book',a.token)).data.contacts[0].user.id,b.user.id);
});
test('contacts: operation retries never overwrite a newer name and operation metadata stores no phone or alias',async t=>{
 const {app,req,users:[a,b]}=await fixture(t);const row=(await manual(req,a,b.user.phone,'Друг')).data;const path=`/contacts/${row.contact_id}/name`,data={version:row.version,custom_name:'Первое',request_id:'name_operation_0001'};
 const first=await req(path,a.token,data);assert.equal(first.status,200);const second=await req(path,a.token,{version:first.data.version,custom_name:'Второе',request_id:'name_operation_0002'});assert.equal(second.status,200);
 const retry=await req(path,a.token,data);assert.equal(retry.status,200);assert.equal(retry.data.custom_name,'Второе');assert.equal(retry.data.version,second.data.version);
 assert.equal((await req(path,a.token,{...data,custom_name:'Подмена'})).status,409);
 const meta=JSON.stringify(app.db.prepare('SELECT * FROM contact_operations').all());assert.ok(!meta.includes(b.user.phone));assert.ok(!meta.includes('Первое'));assert.ok(!meta.includes('Второе'));
});

test('contacts: online privacy masks an active SSE connection independently from phone discovery',async t=>{
 const {app,req,users:[a,b,c]}=await fixture(t);const controller=new AbortController();t.after(()=>controller.abort());
 const response=await globalThis.fetch(`http://127.0.0.1:${app.server.address().port}/api/events`,{headers:{Authorization:'Bearer '+b.token},signal:controller.signal});await response.body.getReader().read();
 assert.equal((await req(`/users/${b.user.id}`,a.token)).data.online,true);
 await req('/contacts/settings',b.token,{presence:'contacts'});assert.equal((await req(`/users/${b.user.id}`,a.token)).data.online,false);
 await req('/contacts/settings',a.token,{discovery:'nobody'});const hidden=await manual(req,b,a.user.phone,'Личный контакт');assert.equal(hidden.data.linked_user_id,null);
 assert.equal((await req(`/users/${b.user.id}`,a.token)).data.online,true);assert.equal((await req(`/users/${b.user.id}`,c.token)).data.online,false);
 await req('/contacts/settings',b.token,{presence:'nobody'});assert.equal((await req(`/users/${b.user.id}`,a.token)).data.online,false);controller.abort();
});
