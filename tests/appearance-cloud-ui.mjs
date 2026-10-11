import assert from 'node:assert/strict';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
import {createApp,fixtureFetch} from './phone-fixture.mjs';
import {writeFile,unlink} from 'node:fs/promises';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-cloud.html',js=root+'src/qa-cloud.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-cloud.jsx"></script>');
await writeFile(js,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useAppearance} from './Appearance';import useCloudAppearance from './useCloudAppearance';import {saveWallpaper} from './background.mjs';function App(){const [session,setSession]=useState(window.__session),[settings,apply]=useAppearance(),[error,setError]=useState(false);useCloudAppearance(session.token,session.user.id,settings,apply,setError);return <><output>{JSON.stringify(settings)}</output><button onClick={()=>apply({theme:'dark',font:'compact',size:13,accent:'#123456'})}>Customize</button><button onClick={async()=>{await saveWallpaper(new Blob([new Uint8Array([1,2,3])],{type:"image/png"}));apply({background:"image"});}}>Wallpaper</button><button onClick={()=>setSession(window.__other)}>Switch account</button><p>{error?'unsaved':'ok'}</p></>;}createRoot(document.getElementById('root')).render(<App/>);`);
const app=createApp({database:':memory:',origins:['http://127.0.0.1:5197']});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+app.server.address().port;
async function request(path,token,data){const r=await fixtureFetch(target+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(r.ok,path);return r.json();}
const owner=await request('/register','',{username:'cloud_ui_owner',name:'Владелец'}),other=await request('/register','',{username:'cloud_ui_other',name:'Другой'});
const vite=await createServer({root,server:{host:'127.0.0.1',port:5197,strictPort:true,proxy:{'/api':target}},logLevel:'error'});await vite.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),errors=[];
try {
 for(const platform of ['web','windows']) {
  async function open(){const context=await browser.newContext();await context.addInitScript(({owner,other,platform})=>{window.__session=owner;window.__other=other;if(platform==='windows')window.volnaDesktop={platform:'win32'};},{owner,other,platform});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5197/qa-cloud.html');return {context,page};}
  let {context,page}=await open();await page.getByText('Customize',{exact:true}).click();
  await page.waitForResponse(r=>r.url().endsWith('/me/appearance/'+platform)&&r.request().method()==='POST'&&r.status()===200);
  assert.equal((await request('/me/appearance/'+platform,owner.token)).settings.theme,'dark');
  await page.getByText('Wallpaper',{exact:true}).click();await page.waitForResponse(r=>r.url().endsWith('/me/appearance/'+platform)&&r.request().method()==='POST'&&r.request().postData().includes('wallpaper')&&r.status()===200);await context.close();
  ({context,page}=await open());await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&JSON.parse(document.querySelector('output').textContent).size===13);
  assert.equal(JSON.parse(await page.locator('output').textContent()).accent,'#123456');
  assert.equal(await page.evaluate(async()=>{const {wallpaperBlob}=await import('/src/background.mjs');return (await wallpaperBlob()).size;}),3);
  await page.getByText('Switch account',{exact:true}).click();await page.waitForFunction(()=>JSON.parse(document.querySelector('output').textContent).accent!=='#123456');
  assert.equal((await request('/me/appearance/'+platform,owner.token)).settings.accent,'#123456');await context.close();
  ({context,page}=await open());await page.route('**/api/me/appearance/'+platform,route=>route.abort());await page.reload();await page.getByText('unsaved',{exact:true}).waitFor();
  assert.equal((await request('/me/appearance/'+platform,owner.token)).settings.theme,'dark');await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: fresh Web/Windows installations restore appearance; account switch is isolated; failed restore does not overwrite cloud');
}finally{await browser.close();await vite.close();await app.close();await unlink(html);await unlink(js);}
