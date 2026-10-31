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
 for(const platform of ['android','windows','electron','linux']){
  const android=platform==='android',handoff=android||platform==='windows';
  const context=await browser.newContext({viewport:android?{width:412,height:915}:{width:1280,height:800},...(android?{userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'}:{})});
  if(['windows','electron'].includes(platform))await context.addInitScript(({electron})=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0'});if(electron)window.volnaDesktop={};},{electron:platform==='electron'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/qr/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/request')?{id:'fixture',poll_token:'fixture',qr_text:'volna://login/'+'b'.repeat(43),expires_in:180}:{status:'pending'})}));
  await page.goto(`http://127.0.0.1:5196/qa-invite-open.html?invite=${invite}`);
  await page.getByRole('heading',{name:handoff?'Приглашение в Волну':'Вход по QR'}).waitFor();
  const link=page.getByRole('link',{name:'Открыть в Волне',exact:true});
  if(handoff){await link.waitFor();assert.equal(await link.getAttribute('href'),'volna://invite/'+invite);assert.equal(await page.getByRole('link',{name:'Установить приложение'}).getAttribute('href'),android?'/download/volna-android.apk':'/download/volna-windows.exe');await mkdir(new URL('../work/auth94',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../work/auth94/invite-android.png',import.meta.url).pathname});}
  else assert.equal(await link.count(),0);
  if(handoff){assert.equal(await page.getByRole('heading',{name:'Вход по QR'}).count(),0);await page.getByRole('button',{name:'Продолжить в браузере'}).click();await page.getByRole('heading',{name:'Вход по QR'}).waitFor();}
  await page.goto('http://127.0.0.1:5196/qa-invite-open.html?invite=invalid');await page.getByRole('heading',{name:'Вход по QR'}).waitFor();assert.equal(await page.getByRole('link',{name:'Открыть в Волне',exact:true}).count(),0);
  assert.deepEqual(errors,[]);await context.close();
 }
 const desktopContext=await browser.newContext();
 await desktopContext.addInitScript(code=>{window.inviteAcknowledged=[];window.volnaDesktop={onOpenChat:()=>()=>{},onShowCall:()=>()=>{},callState:()=>Promise.resolve(),takeInvite:async()=>code,consumeInvite:async value=>{window.inviteAcknowledged.push(value);},onInvite:callback=>{window.deliverInvite=callback;return()=>{delete window.deliverInvite;};}};},invite);
 const desktopPage=await desktopContext.newPage();const desktopErrors=[];desktopPage.on('pageerror',e=>desktopErrors.push(e.message));
 await writeFile(html,'<div id="root"></div><script type="module" src="/src/main.jsx"></script>');
 await desktopPage.goto('http://127.0.0.1:5196/qa-invite-open.html?demo=1');
 await desktopPage.getByRole('button',{name:'Открыть демо',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.error(desktopErrors,await desktopPage.locator('body').innerText());throw e;});
 assert.equal(await desktopPage.getByRole('dialog',{name:'Вступить по приглашению'}).count(),0);
 await desktopPage.getByRole('button',{name:'Открыть демо',exact:true}).click();
 const join=desktopPage.getByRole('dialog',{name:'Вступить по приглашению'});await join.waitFor();
 assert.equal(await join.getByLabel('Приглашение',{exact:true}).inputValue(),invite);
 await join.getByRole('button',{name:'Закрыть сообщество'}).click();
 const next='c'.repeat(48);await desktopPage.evaluate(code=>window.deliverInvite(code),next);await join.waitFor();
 assert.equal(await join.getByLabel('Приглашение',{exact:true}).inputValue(),next);
 assert.deepEqual(await desktopPage.evaluate(()=>window.inviteAcknowledged),[invite,next]);
 await join.getByRole('button',{name:'Закрыть сообщество'}).click();
 const direct='d'.repeat(48),before=desktopPage.url();
 await desktopPage.evaluate(code=>{const a=document.createElement('a');a.href=location.origin+'/app?invite='+code;a.target='_blank';a.textContent='internal invite';document.body.append(a);a.click();a.remove();},direct);
 await join.waitFor();assert.equal(await join.getByLabel('Приглашение',{exact:true}).inputValue(),direct);assert.equal(desktopPage.url(),before);assert.equal(desktopContext.pages().length,1);

 assert.deepEqual(desktopErrors,[]);await desktopContext.close();
 console.log('PASS: Android/Windows browser handoff; Electron QR; pending invite survives login and running client accepts new invite without joining automatically');
}finally{await browser?.close();await vite?.close();await Promise.all([unlink(html).catch(()=>{}),unlink(js).catch(()=>{})]);}
