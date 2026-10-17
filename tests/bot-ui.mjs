import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,rmSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {chromium} from '../client/node_modules/playwright/index.mjs';
import {createApp} from '../server/index.mjs';
const directory=resolve('work/bot-ui');mkdirSync(directory,{recursive:true});const uploads=mkdtempSync(join(tmpdir(),'volna-bot-ui-'));
const app=createApp({database:':memory:',uploads,newsEnabled:false,origins:['http://127.0.0.1:5201']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const token=randomUUID(),uid=Number(app.db.prepare("INSERT INTO users(username,name,phone) VALUES('ui_owner','UI Owner','+79000000001')").run().lastInsertRowid);
app.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),uid,Date.now()+3600000);
const target='http://127.0.0.1:'+app.server.address().port;
const api=async(path,data)=>{const r=await fetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.equal(r.ok,true,await r.clone().text());return r.json();};
const group=await api('/communities',{kind:'group',title:'UI Group',client_id:randomUUID()});
writeFileSync(join(directory,'index.html'),'<html><head><link rel="icon" href="data:,"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/entry.jsx"></script></body></html>');
writeFileSync(join(directory,'entry.jsx'),"import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {openBotManager,GroupBots} from '../../client/src/BotManager.jsx';import {request} from '../../client/src/api.js';import '../../client/src/style.css';import '../../client/src/web-k.css';function Harness(){const [view,setView]=useState('closed'),[chat,setChat]=useState(null),[messages,setMessages]=useState([]),[text,setText]=useState('');async function load(id){setMessages(await request('/chats/'+id+'/messages',window.__token));}async function open(){await openBotManager(window.__token,async c=>{setChat(c);setView('manager');await load(c.id);});}async function send(e){e.preventDefault();await request('/chats/'+chat.id+'/messages',window.__token,{text,client_id:crypto.randomUUID()});setText('');for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,50));const all=await request('/chats/'+chat.id+'/messages',window.__token);setMessages(all);if(all.at(-1)?.sender_is_bot)break;}}return <><button onClick={open}>Мои боты</button><button onClick={()=>setView('group')}>Group access</button>{view==='manager'&&<section aria-label=\"Главный бот\"><p>@{chat.username}</p>{messages.map(m=><p key={m.id}>{m.text}</p>)}<form onSubmit={send}><input aria-label=\"Сообщение\" value={text} onChange={e=>setText(e.target.value)}/><button>Отправить</button></form></section>}{view==='group'&&<GroupBots token={window.__token} chat={{...window.__group,role:'owner'}} onClose={()=>setView('closed')} onChanged={async()=>{}}/>}</>;}createRoot(document.getElementById('root')).render(<Harness/>);");
const vite=await createServer({configFile:false,root:directory,optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{alias:{react:resolve('client/node_modules/react'),'react-dom':resolve('client/node_modules/react-dom')}},server:{host:'127.0.0.1',port:5201,strictPort:true,fs:{allow:[resolve('.')]},proxy:{'/api':target}}});await vite.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1100,height:850}});await context.addInitScript(({token,group})=>{window.__token=token;window.__group=group;},{token,group});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.error('browser:',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('console:',m.text());});await page.goto('http://127.0.0.1:5201/');
 await page.getByRole('button',{name:'Мои боты',exact:true}).click();
 const manager=page.getByRole('region',{name:'Главный бот'});await manager.getByText('@volna_botfather',{exact:true}).waitFor();
 async function command(text,expected){await manager.getByLabel('Сообщение',{exact:true}).fill(text);await manager.getByRole('button',{name:'Отправить',exact:true}).click();await manager.getByText(expected,{exact:false}).last().waitFor();}
 await command('/newbot','Введите название');await command('Браузерный бот','Введите уникальный');await command('browser_test_bot','@browser_test_bot создан');
 const created=await manager.innerText(),secret=created.match(/vbot_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}/)[0];
 await command('/groups @browser_test_bot on','Новый токен');await page.waitForFunction(()=>[...document.querySelectorAll('section[aria-label="Главный бот"] p')].filter(p=>p.textContent.includes('Новый токен')).length>=2);
 await command('/pause @browser_test_bot','Бот @browser_test_bot отключён');
 await command('/resume @browser_test_bot','Бот @browser_test_bot включён');
 assert.equal((await fetch(target+'/bot/v1/me',{headers:{Authorization:'Bearer '+secret}})).status,401);
 await page.getByRole('button',{name:'Group access'}).click();
 const access=page.getByRole('dialog',{name:'Боты и доступ к группе',exact:true});await access.getByLabel('Username бота').fill('browser_test_bot');await access.getByRole('button',{name:'Добавить бота',exact:true}).click();await access.getByText('Только команды, упоминания и ответы',{exact:true}).waitFor();
 await access.getByRole('button',{name:'Разрешить полный доступ',exact:true}).click();await access.getByText('Разрешён доступ ко всем новым сообщениям',{exact:true}).waitFor();
 const bot=(await api('/developer/v1/bots')).bots[0];const credentials=app.db.prepare('SELECT scopes FROM bot_tokens WHERE bot_id=? AND revoked IS NULL').get(bot.id);assert.ok(JSON.parse(credentials.scopes).includes('groups:read_all'));
 await page.setViewportSize({width:390,height:844});assert.equal(await access.evaluate(el=>el.scrollWidth>el.clientWidth),false);
 await page.screenshot({path:'work/bot-ui/group-mobile.png'});await access.getByRole('button',{name:'Удалить из группы',exact:true}).click();await access.getByText('В группе пока нет ботов с разрешениями.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: main-bot chat creation, scope/token rotation, pause/resume, group grants and mobile dialog layout.');await context.close();
}finally{await browser.close();await vite.close();await app.close();rmSync(uploads,{recursive:true,force:true});rmSync(join(directory,'index.html'),{force:true});rmSync(join(directory,'entry.jsx'),{force:true});}
