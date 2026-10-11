import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {writeFile,unlink} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-forum.html',js=root+'src/qa-forum.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-forum.jsx"></script>');
await writeFile(js,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Topics from './Topics';import './style.css';import './message-format.css';function App(){const [revision,setRevision]=useState(0),[selected,setSelected]=useState(null);return <><Topics group={window.__group} token={window.__session.token} revision={revision} onChanged={()=>setRevision(v=>v+1)} onClose={()=>{}} onSelect={(chat,m)=>setSelected({chat,message:m?.id})}/><output>{JSON.stringify(selected)}</output></>;}createRoot(document.getElementById('root')).render(<App/>);`);
const app=createApp({database:':memory:',origins:['http://127.0.0.1:5196']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+app.server.address().port;
async function request(path,token,data,method){const r=await fixtureFetch(target+'/api'+path,{method:method||(data===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(r.ok,path);return r.json();}
const owner=await request('/register','',{username:'ui_forum_owner',name:'Владелец'}),member=await request('/register','',{username:'ui_forum_member',name:'Участник'}),group=await request('/communities',owner.token,{kind:'group',title:'Команда',client_id:crypto.randomUUID()});await request(`/communities/${group.id}/add`,owner.token,{user_id:member.user.id});
const topic=await request(`/groups/${group.id}/topics`,owner.token,{name:'Разработка',icon:'💻',client_id:crypto.randomUUID()});const message=await request(`/chats/${topic.id}/messages`,owner.token,{text:'**Общий поиск** и ||спойлер||',client_id:crypto.randomUUID()});await request(`/chats/${group.id}/messages`,member.token,{text:'Общие сообщения',client_id:crypto.randomUUID()});
const vite=await createServer({root,server:{host:'127.0.0.1',port:5196,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
try {
 for(const mode of ['web','windows','mobile']){
  await request(`/groups/${group.id}/topics/${topic.id}`,owner.token,{pinned:false,closed:false},'PATCH');await request(`/groups/${group.id}/topics/settings`,owner.token,{enabled:true});
  const context=await browser.newContext({viewport:mode==='mobile'?{width:390,height:844}:{width:1140,height:800},permissions:['clipboard-read','clipboard-write']});await context.addInitScript(({session,group,desktop})=>{window.__session=session;window.__group={...group,name:'Команда',role:'owner'};if(desktop)window.volnaDesktop={platform:'win32'};},{session:owner,group,desktop:mode==='windows'});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5196/qa-forum.html');
  const dialog=page.getByRole('dialog',{name:'Темы · Команда',exact:true});await dialog.getByRole('button',{name:'💻 Разработка',exact:false}).waitFor();
  const card=dialog.locator('.topic-card').filter({hasText:'Разработка'});await card.locator('summary').click();await card.getByRole('button',{name:'Закрепить',exact:true}).click();await card.getByRole('button',{name:'Открепить',exact:true}).waitFor();
  await card.getByRole('button',{name:'Скопировать ссылку',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),new RegExp('/app\\?chat='+topic.id+'$'));
  await card.getByRole('button',{name:'Закрыть тему',exact:true}).click();await card.getByRole('button',{name:'Открыть тему',exact:true}).waitFor();
  await dialog.getByRole('tab',{name:'Все сообщения',exact:true}).click();await dialog.getByText('Общий поиск',{exact:false}).waitFor();assert.equal(await dialog.locator('.formatted-paragraph strong').first().textContent(),'Общий поиск');
  await dialog.getByLabel('Поиск по всем темам',{exact:true}).fill('поиск');await page.waitForFunction(()=>document.querySelectorAll('.forum-feed article').length===1);await dialog.locator('.forum-topic-link').click();assert.deepEqual(JSON.parse(await page.locator('output').textContent()),{chat:topic.id,message:message.id});
  await dialog.getByRole('tab',{name:'Темы',exact:true}).click();await dialog.getByRole('button',{name:'💻 Разработка',exact:false}).waitFor();await dialog.locator('.forum-settings>summary').click();await dialog.getByLabel('Режим тем',{exact:true}).uncheck();await page.waitForFunction(()=>!document.querySelector('.forum-settings input').checked);
  assert.equal((await request(`/groups/${group.id}/topics`,owner.token)).enabled,false);await request(`/groups/${group.id}/topics/settings`,owner.token,{enabled:true});
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog must fit viewport');await page.screenshot({path:'/tmp/volna32-forum-'+mode+'.png'});await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: forum topic actions, copied links, formatted searchable feed, jump targets and compact Web/Windows/mobile dialogs');
}finally{await browser.close();await vite.close();await app.close();await unlink(html);await unlink(js);}
