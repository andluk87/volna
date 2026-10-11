import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {preview} from '../client/node_modules/vite/dist/node/index.js';
const server=await preview({root:new URL('../client/',import.meta.url).pathname,preview:{host:'127.0.0.1',port:5192,strictPort:true},logLevel:'error'});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const artifactDirectory=new URL('../design/checks/0.12.30/',import.meta.url).pathname;mkdirSync(artifactDirectory,{recursive:true});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Проверка без сервера"}'}));
  await page.goto('http://127.0.0.1:5192/');await page.getByRole('heading',{name:'Разговоры, которые рядом.'}).waitFor();
  assert.equal(await page.locator('a[href*="demo"]').count(),0);
  assert.equal(await page.locator('.site-login').count(),0,'login polling only begins after entry');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  assert.equal(await page.locator('a[href$="volna-android.apk"]').count(),1);assert.equal(await page.locator('a[href$="volna-windows.exe"]').count(),1);
  assert.ok(await page.locator('.site-hero img').evaluate(el=>el.complete&&el.naturalWidth===512));
  await page.locator('.site-home>footer').scrollIntoViewIfNeeded();assert.ok(await page.locator('.site-home>footer').evaluate(el=>el.getBoundingClientRect().top<innerHeight),'footer is reachable');await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${artifactDirectory}site-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Войти в браузере',exact:true}).click();await page.locator('.site-login').waitFor();
  await page.goto('http://127.0.0.1:5192/app?demo=1');assert.equal(await page.getByRole('button',{name:'Открыть демо',exact:true}).count(),0,'production ignores demo query');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: production landing desktop/mobile, downloads, lazy login and no demo access');
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
