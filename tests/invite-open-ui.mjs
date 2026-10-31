import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-invite-open.html',js=root+'src/qa-invite-open.jsx';
const invite='a'.repeat(48);let browser,vite;
try{
 await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-invite-open.jsx"></script>');
 await writeFile(js,"import React from 'react';import {createRoot} from 'react-dom/client';import PhoneQrLogin from './PhoneQrLogin';import './style.css';const accepted=()=>{};createRoot(document.getElementById('root')).render(<PhoneQrLogin onSession={accepted}/>);");
 vite=await createServer({root,server:{host:'127.0.0.1',port:5196,strictPort:true},logLevel:'error'});await vite.listen();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const android of [true,false]){
  const context=await browser.newContext({viewport:android?{width:412,height:915}:{width:1280,height:800},...(android?{userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'}:{})});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/qr/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/request')?{id:'fixture',poll_token:'fixture',qr_text:'volna://login/'+'b'.repeat(43),expires_in:180}:{status:'pending'})}));
  await page.goto(`http://127.0.0.1:5196/qa-invite-open.html?invite=${invite}`);
  await page.getByRole('heading',{name:android?'Приглашение в Волну':'Вход по QR'}).waitFor();
  const link=page.getByRole('link',{name:'Открыть в Волне',exact:true});
  if(android){await link.waitFor();assert.equal(await link.getAttribute('href'),'volna://invite/'+invite);await mkdir(new URL('../work/auth94',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../work/auth94/invite-android.png',import.meta.url).pathname});}
  else assert.equal(await link.count(),0);
  if(android){assert.equal(await page.getByRole('heading',{name:'Вход по QR'}).count(),0);await page.getByRole('button',{name:'Продолжить в браузере'}).click();await page.getByRole('heading',{name:'Вход по QR'}).waitFor();}
  await page.goto('http://127.0.0.1:5196/qa-invite-open.html?invite=invalid');await page.getByRole('heading',{name:'Вход по QR'}).waitFor();assert.equal(await page.getByRole('link',{name:'Открыть в Волне',exact:true}).count(),0);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: Android invite handoff uses validated code; desktop QR and invalid-link handling preserved');
}finally{await browser?.close();await vite?.close();await Promise.all([unlink(html).catch(()=>{}),unlink(js).catch(()=>{})]);}
