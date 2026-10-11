import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const vite=await createServer({root:new URL('../client/',import.meta.url).pathname,server:{host:'127.0.0.1',port:5190,strictPort:true},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:1140,height:800}});await context.addInitScript(()=>{const noop=()=>()=>{};window.volnaDesktop={platform:'win32',onShortcut:noop,onOpenChat:noop,onShowCall:noop,onUpdate:noop,updateState:async()=>null,unreadCount:async()=>{},notifyMessage:async()=>{},callState:async()=>{},notificationStatus:async()=>({systemEnabled:true})};});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);await page.goto('http://127.0.0.1:5190/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();await page.getByLabel('Настройки и действия',{exact:true}).click();await page.locator('.main-menu').getByRole('button',{name:'Контакты',exact:true}).click();await page.getByRole('dialog',{name:'Контакты',exact:true}).waitFor();
await page.getByRole('button',{name:'Добавить контакт',exact:true}).click();await page.getByRole('dialog',{name:'Добавить контакт',exact:true}).waitFor();await page.getByLabel('Имя контакта',{exact:true}).fill('Проверка');await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Добавить контакт',exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog',{name:'Контакты',exact:true}).count(),1,'Escape closes only the child');
assert.equal(await page.getByRole('button',{name:'Добавить контакт',exact:true}).evaluate(el=>el===document.activeElement),true,'focus returns to opener');
await page.getByRole('button',{name:'Добавить контакт',exact:true}).click();await page.getByRole('dialog',{name:'Добавить контакт',exact:true}).waitFor();await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('dialog',{name:'Добавить контакт',exact:true}).evaluate(el=>el.contains(document.activeElement)),true,'Tab stays in top dialog');
await page.getByLabel('Закрыть Добавить контакт',{exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'Контакты',exact:true}).count(),1);
await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Контакты',exact:true}).waitFor({state:'hidden'});
await page.getByLabel('Настройки и действия',{exact:true}).click();await page.locator('.main-menu').getByRole('button',{name:'Настройки',exact:true}).click();
const settings=page.getByRole('dialog',{name:'Настройки',exact:true});
for(const title of ['Уведомления','Звук и камера','Данные и хранилище','Редактировать профиль','Звонки','Контакты и синхронизация']){await settings.getByRole('button',{name:title,exact:true}).click();await settings.getByRole('heading',{name:title==='Редактировать профиль'?'Мой профиль':title,exact:true,level:2}).waitFor();assert.equal(await page.getByRole('dialog').count(),1,'settings page stays in one window');if(title==='Контакты и синхронизация')await settings.getByText('Кто видит меня в сети',{exact:false}).waitFor();await settings.getByLabel('Назад к настройкам',{exact:true}).click();}
assert.ok(await settings.locator('.settings-row').first().evaluate(el=>el.getBoundingClientRect().height)<=44,'desktop settings use compact rows');await page.keyboard.press('Escape');
await page.locator('.chat-row').first().click();await page.locator('[data-message-id]').first().waitFor();
const messages=page.locator('[data-message-id]:not(.deleted)');assert.ok(await messages.count()>=2);
await messages.last().scrollIntoViewIfNeeded();await page.waitForTimeout(200);
const first=await messages.nth((await messages.count())-2).boundingBox(),second=await messages.last().boundingBox();
await page.mouse.move(first.x+5,first.y+first.height-8);await page.mouse.down();await page.mouse.move(second.x+5,second.y+second.height-8,{steps:10});await page.mouse.up();assert.equal(await page.locator('.message-selected').count(),2,'mouse drag selects two messages');await page.locator('.selection-bar').getByRole('button',{name:'Переслать',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
assert.deepEqual(errors,[]);
console.log('PASS: nested contact dialogs close one layer, trap focus in the top layer and restore the opener');
}finally{await browser.close();await vite.close();}
