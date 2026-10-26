import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {windowChromeOptions,applyWindowChrome,WINDOW_TITLEBAR_HEIGHT}=createRequire(import.meta.url)('../client/electron/window-chrome.cjs');
test('Windows keeps native caption controls with a fixed app-colored overlay; other platforms keep their frame',()=>{
 assert.deepEqual(windowChromeOptions('linux'),{});assert.deepEqual(windowChromeOptions('darwin'),{});
 const options=windowChromeOptions('win32');assert.equal(options.titleBarStyle,'hidden');assert.equal(options.titleBarOverlay.height,WINDOW_TITLEBAR_HEIGHT);
 const calls=[],window={isDestroyed:()=>false,setBackgroundColor:color=>calls.push(['background',color]),setTitleBarOverlay:value=>calls.push(['overlay',value])};
 assert.equal(applyWindowChrome(window,'dark','win32'),true);assert.equal(calls.at(-1)[1].color,'#242f3d');
 assert.equal(applyWindowChrome(window,'light','win32'),true);assert.equal(calls.at(-1)[1].color,'#f1f1f1');
 const before=calls.length;assert.throws(()=>applyWindowChrome(window,'#123456','win32'),/Invalid window theme/);assert.equal(applyWindowChrome(window,'dark','linux'),false);assert.equal(calls.length,before);
});
