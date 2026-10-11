import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {mkdir} from 'node:fs/promises';
const vite=await createServer({root:new URL('../client/',import.meta.url).pathname,server:{host:'127.0.0.1',port:5188,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors=[];await mkdir('/tmp/volna29-screens',{recursive:true});
try{for(const desktop of [false,true])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width:1436,height:900},colorScheme:theme});
 await context.addInitScript(({desktop,theme})=>{localStorage.setItem('volna.appearance',JSON.stringify({theme,animations:false,...(desktop?{size:14,radius:8}:{})}));if(desktop){const noop=()=>()=>{},listeners=[];window.__desktopShortcut=key=>listeners.forEach(fn=>fn(key));window.volnaDesktop={platform:'win32',onShortcut:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onOpenChat:noop,onShowCall:noop,onUpdate:noop,updateState:async()=>null,unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true})};}},{desktop,theme});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const start=async()=>{await page.goto('http://127.0.0.1:5188/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();await page.locator('.chat-row').first().click();await page.getByLabel('Сообщение',{exact:true}).waitFor();};await start();
 const row=await page.locator('.chat-row').first().boundingBox(),wrap=await page.locator('.chat-row-wrap').first().boundingBox();assert.ok(Math.abs(row.width-wrap.width)<1,'chat row fills its selection area');assert.equal((await page.locator('.chat-row .avatar').first().boundingBox()).width,desktop?46:54);
 const handle=page.getByRole('separator',{name:'Ширина списка чатов'}),width=desktop?392:360;
 assert.equal(Math.round((await page.locator('.sidebar').first().boundingBox()).width),width);
 const rect=await handle.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+150);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+80,rect.y+150);await page.mouse.up();
 assert.equal(Math.round((await page.locator('.sidebar').first().boundingBox()).width),width+80);
 assert.equal(await page.evaluate(desktop=>localStorage.getItem('volna.columns.'+(desktop?'desktop':'web')),desktop),String(width+80));
 await start();assert.equal(Math.round((await page.locator('.sidebar').first().boundingBox()).width),width+80);
 await handle.press('Home');assert.equal(Math.round((await page.locator('.sidebar').first().boundingBox()).width),desktop?300:320);
 await handle.dblclick();assert.equal(Math.round((await page.locator('.sidebar').first().boundingBox()).width),width);
 await page.getByRole('tab',{name:'Группы',exact:true}).click();
 const names=await page.locator('.chat-row .chat-copy strong').allTextContents();assert.ok(names.length>1);
 const nextChat=async()=>{if(desktop)await page.evaluate(()=>window.__desktopShortcut('next-chat'));else await page.keyboard.press('Alt+ArrowDown');};
 await nextChat();await page.waitForFunction(name=>document.querySelector('.chat-row[aria-current=page] .chat-copy strong')?.textContent===name,names[0]);
 await nextChat();await page.waitForFunction(name=>document.querySelector('.chat-row[aria-current=page] .chat-copy strong')?.textContent===name,names[1]);
 await page.getByRole('tab',{name:'Все чаты',exact:true}).click();
 await page.keyboard.press('Control+,');await page.getByRole('heading',{name:'Настройки',exact:true}).waitFor();await page.locator('.settings-sidebar').getByLabel('Назад к чатам',{exact:true}).click();
 for(const next of [theme==='dark'?'light':'dark',theme]){await page.getByLabel('Настройки и действия',{exact:true}).click();await page.getByRole('switch',{name:'Ночной режим',exact:true}).click();await page.waitForFunction(t=>document.documentElement.dataset.theme===t,next);}
 const editor=page.getByLabel('Сообщение',{exact:true});await editor.fill('Проверка быстрого редактирования');await editor.press('Enter');await page.locator('.message.outgoing').filter({hasText:'Проверка быстрого редактирования'}).waitFor();assert.equal(await editor.innerText(),'');assert.equal(await editor.evaluate(el=>el===document.activeElement),true);
 await editor.press('ArrowUp');assert.equal(await editor.innerText(),'Проверка быстрого редактирования');await editor.press('Escape');assert.equal(await editor.innerText(),'');
 await page.getByRole('button',{name:'Информация о чате',exact:true}).click();await page.locator('.info-panel').waitFor();
 await page.locator('.chat-row').first().click({button:'right'});await page.locator('.chat-actions[open]').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('.chat-actions[open]').count(),0);assert.equal(await page.locator('.info-panel').count(),1);await page.keyboard.press('Escape');await page.locator('.info-panel').waitFor({state:'hidden'});assert.equal(await page.locator('.info-panel').count(),0);
 await page.locator('.attach-menu>summary').click();assert.equal(await page.locator('.attach-menu[open]').count(),1);await editor.click();assert.equal(await page.locator('.attach-menu[open]').count(),0);
 await page.getByLabel('Эмодзи',{exact:true}).click();assert.equal(await page.locator('.emoji-docked').count(),desktop?1:0);await page.getByLabel('Закрыть эмодзи').click();
 await page.screenshot({path:`/tmp/volna29-screens/${desktop?'desktop':'web'}-${theme}.png`});
 for(const w of [1920,1366,1140,1024,800,390]){await page.setViewportSize({width:w,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+w);const visible=await handle.count();assert.equal(visible,w>(desktop?760:925)?1:0);await page.getByRole('button',{name:'Информация о чате',exact:true}).click();const info=await page.locator('.info-panel').boundingBox();assert.ok(info.x>=-1&&info.x+info.width<=w+1);await page.getByLabel('Закрыть информацию',{exact:true}).click();}
 await context.close();console.log('PASS:',desktop?'desktop':'web',theme,'resize, saved width, menus, focus, ArrowUp edit, Escape layers, responsive panels');
}assert.deepEqual(errors,[]);}finally{await browser.close();await vite.close();}
