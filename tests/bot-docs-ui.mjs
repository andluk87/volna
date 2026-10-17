import assert from 'node:assert/strict';
import {preview} from '../client/node_modules/vite/dist/node/index.js';
import {chromium} from '../client/node_modules/playwright/index.mjs';
const server=await preview({root:new URL('../client/',import.meta.url).pathname,preview:{host:'127.0.0.1',port:5196,strictPort:true},logLevel:'error'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[],apiRequests=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:503,contentType:'application/json',body:'{}'});});
  await page.goto('http://127.0.0.1:5196/developers/bots');await page.getByRole('heading',{name:'Создайте своего бота в Волне',exact:true}).waitFor();assert.match(await page.title(),/Bot API/);assert.deepEqual(apiRequests,[],'public docs must not start authenticated API calls');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'docs fit viewport '+width);
  for(const link of await page.locator('nav a[href^="#"]').all()){const href=await link.getAttribute('href');assert.equal(await page.locator(href).count(),1,'working section anchor');}
  await page.getByRole('button',{name:'Копировать: Проверить токен',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/http:\/\/127.0.0.1:5196\/bot\/v1\/me/);
  const example=await page.request.get('http://127.0.0.1:5196/developers/echo-bot.py');assert.equal(example.status(),200);assert.match(await example.text(),/Idempotency-Key/);assert.match(await example.text(),/remember\(offset\)/);
  await page.goto('http://127.0.0.1:5196/developers/bots/');await page.getByRole('heading',{name:'Доставка через webhook',exact:true}).waitFor();
  await page.goto('http://127.0.0.1:5196/');await page.getByRole('link',{name:'Разработчикам',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'homepage navigation fits '+width);
  await page.getByRole('link',{name:'Разработчикам',exact:true}).click();await page.getByRole('heading',{name:'Создайте своего бота в Волне',exact:true}).waitFor();assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: developer docs without login, direct routes, desktop/mobile, clipboard, homepage links and downloadable Python bot.');
}finally{await browser.close();await new Promise(r=>server.httpServer.close(r));}
