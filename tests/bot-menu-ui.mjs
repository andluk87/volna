import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-bot-menu.html',js=root+'src/qa-bot-menu.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-bot-menu.jsx"></script>');
await writeFile(js,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import BotCommandMenu from './BotCommandMenu';import {request} from './api';import './style.css';function App(){const [chat,setChat]=useState(1),[draft,setDraft]=useState('Мой черновик'),[disabled,setDisabled]=useState(false);return <><button onClick={()=>setChat(2)}>Другой бот</button><button onClick={()=>setChat(3)}>Обычный чат</button><button onClick={()=>setDisabled(v=>!v)}>Занято</button><form className="composer" style={{position:'fixed',bottom:10,left:10,right:10}} onSubmit={e=>{e.preventDefault();throw Error('Unexpected form submission')}}><div className="composer-surface"><BotCommandMenu chatId={chat} token="test" disabled={disabled} onCommand={command=>request('/chats/'+chat+'/messages','test',{text:command,client_id:'menu-command-000001'})}/><input aria-label="Черновик" value={draft} onChange={e=>setDraft(e.target.value)}/></div></form></>;}createRoot(document.getElementById('root')).render(<App/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});await vite.listen();const base='http://127.0.0.1:'+vite.httpServer.address().port;let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const desktop of [false,true]){
  const context=await browser.newContext({viewport:{width:desktop?1000:390,height:700}}),page=await context.newPage(),sent=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));if(desktop)await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.desktop='true'));
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data={};if(path.endsWith('/bot-commands'))data={commands:path.includes('/1/')?[{command:'/calllog',description:'Журнал на 24 часа'},{command:'/revoke',description:'Отозвать доступ'},{command:'/help',description:'Команды'}]:path.includes('/2/')?[{command:'/status',description:'Другой бот'}]:[]};if(path.endsWith('/messages')){sent.push({path,...route.request().postDataJSON()});data={id:1};}return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
  await page.goto(base+'/qa-bot-menu.html');await page.getByRole('button',{name:'Меню',exact:true}).click();await page.getByRole('menuitem',{name:'/calllog Журнал на 24 часа',exact:true}).waitFor();
  const bounds=await page.getByRole('menu').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=(desktop?1000:390)&&bounds.y>=0);
  await page.getByRole('menuitem',{name:'/calllog Журнал на 24 часа',exact:true}).click();await page.getByRole('menu').waitFor({state:'hidden'});assert.deepEqual(sent.map(x=>[x.path,x.text]),[['/api/chats/1/messages','/calllog']]);assert.equal(await page.getByRole('textbox',{name:'Черновик'}).inputValue(),'Мой черновик');
  await page.getByRole('button',{name:'Меню',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Другой бот',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).click();await page.getByRole('menuitem',{name:'/status Другой бот',exact:true}).waitFor();assert.equal(await page.getByRole('menuitem').count(),1);await page.getByRole('menuitem').click();await page.getByRole('menu').waitFor({state:'hidden'});assert.equal(sent.at(-1).text,'/status');
  await page.getByRole('button',{name:'Занято',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Меню',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Обычный чат',exact:true}).click();await page.getByRole('button',{name:'Меню',exact:true}).waitFor({state:'hidden'});assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: Web/Windows bot-specific menus, immediate command POST, preserved draft, Escape, disabled and ordinary chats');
}finally{await browser?.close();await vite.close();await Promise.all([unlink(html).catch(()=>{}),unlink(js).catch(()=>{})]);}
