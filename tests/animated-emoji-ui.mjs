import assert from 'node:assert/strict';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
import {chromium} from '../client/node_modules/playwright-core/index.mjs';
import {createServer} from '../client/node_modules/vite/dist/node/index.js';
const root=new URL('../client/',import.meta.url).pathname,html=root+'qa-animated-emoji.html',jsx=root+'src/qa-animated-emoji.jsx';
await writeFile(html,'<div id="root"></div><script type="module" src="/src/qa-animated-emoji.jsx"></script>');
await writeFile(jsx,`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import MessageText from './MessageText';
import './telegram-emoji.css';import './message-format.css';import './message-layout.css';
function App(){const[count,setCount]=useState(0),[text,setText]=useState('😁'),[show,setShow]=useState(true),[auto,setAuto]=useState(true);
return <><button id="render" onClick={()=>setCount(count+1)}>Render {count}</button><button id="change" onClick={()=>setText('❤️')}>Heart</button><button id="unmount" onClick={()=>setShow(false)}>Unmount</button><button id="no-auto" onClick={()=>setAuto(false)}>Disable autoplay</button>
<div className="messages"><article id="solo" className="message emoji-only-message">{show&&<MessageText text={text} largeEmoji animateEmoji={auto} meta={<small>12:34</small>}/>}</article></div>
<div id="mixed"><MessageText text="Текст 😁" largeEmoji/></div><div id="caption"><MessageText text="😁"/></div><div id="custom"><MessageText text="😁" largeEmoji entities={[{id:'custom',start:0,length:2}]}/></div>
<div style={{height:1500}}/><div id="offscreen"><MessageText text="🥳" largeEmoji/></div></>};createRoot(document.getElementById('root')).render(<App/>);`);
const vite=await createServer({root,server:{host:'127.0.0.1',port:5196,strictPort:true},logLevel:'error'});let browser;
try{
 await vite.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors=[];
 const context=await browser.newContext({viewport:{width:1100,height:720},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.route('**/api/**',route=>route.fulfill({status:404,body:'{}'}));
 await page.goto('http://localhost:5196/qa-animated-emoji.html');
 const button=page.locator('#solo .animated-emoji'),surface=page.locator('#solo .animated-emoji-surface');
 await page.locator('#solo .animated-emoji.is-ready svg').waitFor();
 const frame=()=>surface.innerHTML();
 const first=await frame();await page.waitForTimeout(500);assert.notEqual(await frame(),first,'animation moves');
 assert.equal(await page.locator('#mixed .animated-emoji,#caption .animated-emoji,#custom .animated-emoji').count(),0);
 assert.equal(requests.filter(u=>/tg_emoji_004.tgs/.test(u)).length,0,'offscreen animation is lazy');
 await page.waitForTimeout(3300);const end=await frame();await page.waitForTimeout(300);assert.equal(await frame(),end,'plays once');
 await page.locator('#render').click();assert.equal(await frame(),end,'parent rerender does not restart');
 await button.click();await page.waitForTimeout(400);assert.notEqual(await frame(),end,'click replays');
 await button.focus();await page.keyboard.press('Space');await page.waitForTimeout(200);assert.ok(await button.isEnabled());
 await page.locator('#change').click();await page.locator('#solo .animated-emoji.is-ready svg').waitFor();assert.equal(await button.getAttribute('data-emoji-fallback'),'❤️');
 await button.evaluate(el=>{const r=document.createRange();r.selectNode(el);const s=getSelection();s.removeAllRanges();s.addRange(r);});await page.keyboard.press('Control+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'❤️');
 await page.evaluate(()=>getSelection().removeAllRanges());
 await page.locator('#offscreen').scrollIntoViewIfNeeded();await page.locator('#offscreen .animated-emoji.is-ready svg').waitFor();await page.waitForTimeout(150);const paused=await frame();await page.waitForTimeout(300);assert.equal(await frame(),paused,'offscreen playback pauses');assert.equal(requests.filter(u=>/tg_emoji_004.tgs/.test(u)).length,1);
 await page.locator('#solo').scrollIntoViewIfNeeded();await page.locator('#unmount').click();assert.equal(await page.locator('#solo svg').count(),0);
 // With reduced motion the first frame is static; deliberate playback still works.
 const reduced=await browser.newPage({reducedMotion:'reduce'});reduced.on('pageerror',e=>errors.push(e.message));await reduced.route('**/api/**',route=>route.fulfill({status:404,body:'{}'}));await reduced.goto('http://localhost:5196/qa-animated-emoji.html');await reduced.locator('#solo .is-ready svg').waitFor();const still=await reduced.locator('#solo .animated-emoji-surface').innerHTML();await reduced.waitForTimeout(400);assert.equal(await reduced.locator('#solo .animated-emoji-surface').innerHTML(),still);
 await reduced.locator('#solo .animated-emoji').click();await reduced.waitForTimeout(400);assert.notEqual(await reduced.locator('#solo .animated-emoji-surface').innerHTML(),still);
 await reduced.locator('#no-auto').click();await reduced.locator('#solo .is-ready svg').waitFor();const disabled=await reduced.locator('#solo .animated-emoji-surface').innerHTML();await reduced.waitForTimeout(300);assert.equal(await reduced.locator('#solo .animated-emoji-surface').innerHTML(),disabled);
 // Download failure leaves the Unicode glyph visible, with no broken image.
 const broken=await browser.newPage();broken.on('pageerror',e=>errors.push(e.message));await broken.route('**/api/**',route=>route.fulfill({status:404,body:'{}'}));await broken.route('**/*.tgs',route=>route.fulfill({status:404,body:'missing'}));await broken.goto('http://localhost:5196/qa-animated-emoji.html');await broken.locator('#solo .animated-emoji:disabled').waitFor();assert.equal(await broken.locator('#solo .animated-emoji-fallback').innerText(),'😁');assert.equal(await broken.locator('#solo svg').count(),0);
 await mkdir('work/animated-emoji',{recursive:true});await reduced.screenshot({path:'work/animated-emoji/reduced-motion.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: local SVG playback, one-shot, replay, rerender, lazy loading, Unicode copy, unmount, reduced motion, settings and download fallback');
}finally{await browser?.close();await vite.close();await Promise.all([unlink(html),unlink(jsx)]);}
