import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  localStorage.clear();sessionStorage.clear();
  const listeners=[];window.desktopTestShortcut=key=>listeners.forEach(fn=>fn(key));
  const noop=()=>()=>{};
  window.volnaDesktop={platform:'win32',onShortcut:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onOpenChat:noop,onShowCall:noop,onUpdate:noop,updateState:async()=>null,unreadCount:async n=>{window.desktopTestUnread=n;},callState:async()=>{},loadSession:async()=>null,saveSession:async()=>{},clearSession:async()=>{}};
 });
 await page.goto('/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();await expect(page.locator('.chat-row')).toHaveCount(23);
});
test('Windows has desktop rows, full-width composer and settings without replacing the chat list',async({page})=>{
 expect((await page.locator('.chat-row').first().boundingBox()).height).toBe(62);
 expect((await page.locator('.chat-row .avatar').first().boundingBox()).width).toBe(46);
 expect(await page.locator('.chat-row').first().evaluate(el=>getComputedStyle(el).borderRadius)).toBe('0px');
 const row=await page.locator('.chat-row').first().boundingBox(),list=await page.locator('.chat-list').boundingBox();expect(Math.abs(row.width-list.width)).toBeLessThan(3);
 await page.locator('.chat-row').filter({hasText:'Анна Смирнова'}).first().click();
 await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toBeVisible();
 const composer=await page.locator('.composer').boundingBox(),chat=await page.locator('.conversation').boundingBox();expect(Math.abs(composer.width-chat.width)).toBeLessThan(3);
 await page.getByRole('button',{name:'Информация о чате',exact:true}).click();
 await expect(page.locator('.info-panel')).toBeVisible();
 const info=await page.locator('.info-panel').boundingBox();expect(info.y).toBe(0);await expect.poll(async()=>{const bounds=await page.locator('.info-panel').boundingBox();return bounds.x+bounds.width;}).toBeLessThanOrEqual(page.viewportSize().width+1);
 await page.getByRole('button',{name:'Закрыть информацию'}).click();
 await page.evaluate(()=>window.desktopTestShortcut('chat-search'));await expect(page.getByLabel('Текст поиска',{exact:true})).toBeFocused();await page.getByLabel('Закрыть панель',{exact:true}).click();
 await page.evaluate(()=>window.desktopTestShortcut('settings'));
 await expect(page.getByRole('dialog',{name:'Настройки',exact:true})).toBeVisible();if(page.viewportSize().width>760)await expect(page.locator('.chat-row').first()).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(()=>window.desktopTestShortcut('search'));await expect(page.getByRole('textbox',{name:'Поиск пользователей и чатов'})).toBeFocused();
});
test('Windows menu is a left drawer and closes through its backdrop',async({page})=>{
 await page.getByLabel('Настройки и действия',{exact:true}).click();
 const menu=await page.locator('.app-menu-content').boundingBox();expect(menu.x).toBe(0);expect(menu.y).toBe(0);expect(menu.width).toBe(274);
 await page.mouse.click(page.viewportSize().width-10,200);await expect(page.locator('.main-menu')).not.toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
