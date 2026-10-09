import {test,expect} from '@playwright/test';
const errors=new WeakMap();
test.beforeEach(async({page},info)=>{
 const failures=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.message));
 await page.addInitScript(({theme})=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('volna.appearance',JSON.stringify({theme,animations:false}));},{theme:info.project.name.endsWith('-dark')?'dark':'light'});
 await page.goto('/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();await expect(page.locator('.chat-row')).toHaveCount(23);
});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function openChat(page,name='Анна Смирнова'){await page.locator('.chat-row').filter({hasText:name}).first().click();await expect(page.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true})).toBeVisible();}
async function back(page){const button=page.getByRole('button',{name:'Назад к чатам',exact:true});if(await button.isVisible())await button.click();}

test('pin jumps directly to a visible highlighted message without opening a panel',async({page})=>{
 await openChat(page);const banner=page.getByRole('region',{name:'Закреплённое сообщение',exact:true});
 await expect(banner).toContainText('Закреплённое сообщение');await expect(banner).not.toContainText('Открыть');
 expect((await banner.boundingBox()).height).toBe(48);
 await banner.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();
 const message=page.locator('#message-101');await expect(message).toHaveClass(/message-jump-highlight/);await expect(message).toBeInViewport();
 await expect(page.locator('.details-panel')).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Просмотр сообщения'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('multiple pins cycle and closing the strip does not unpin messages',async({page})=>{
 await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);await demoRequest('/messages/104/pin',{pinned:true},'POST');});
 await openChat(page);const banner=page.getByRole('region',{name:'Закреплённое сообщение',exact:true});await expect(banner).toContainText('Голосовое сообщение');await expect(banner).toContainText('#2');
 await banner.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();await expect(page.locator('#message-104')).toHaveClass(/message-jump-highlight/);await expect(banner).toContainText('#1');
 await banner.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();await expect(page.locator('#message-101')).toHaveClass(/message-jump-highlight/);await expect(banner).toContainText('#2');
 await banner.getByRole('button',{name:'Скрыть закреплённое сообщение',exact:true}).click();await expect(banner).toHaveCount(0);
 expect(await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);return (await demoRequest('/chats/1/pins')).length;})).toBe(2);
 await back(page);await openChat(page,'Дизайн Волны');await back(page);await openChat(page);await expect(banner).toBeVisible();
});

test('older pins load into the conversation instead of opening a message dialog',async({page})=>{
 await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);for(let i=0;i<65;i++)await demoRequest('/chats/1/messages',{text:'Позднее сообщение '+i,client_id:'pin-history-'+i},'POST');});
 await openChat(page);await expect(page.locator('#message-101')).toHaveCount(0);await expect(page.locator('.messages article.message')).toHaveCount(50);
 await page.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();await expect(page.locator('#message-101')).toHaveClass(/message-jump-highlight/);await expect(page.locator('#message-101')).toBeInViewport();
 await expect(page.getByRole('dialog',{name:'Просмотр сообщения'})).toHaveCount(0);await expect(page.locator('.details-panel')).toHaveCount(0);
});

test('the pin link supports keyboard activation',async({page})=>{
 await openChat(page);const button=page.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true});await button.focus();await page.keyboard.press('Enter');await expect(page.locator('#message-101')).toHaveClass(/message-jump-highlight/);
});

test('repinning restores a hidden banner immediately and composer stays ready',async({page})=>{
 await openChat(page);
 const editor=page.getByRole('textbox',{name:'Сообщение',exact:true});await expect(editor).toBeFocused();
 const attachment=page.getByLabel('Прикрепить вложение',{exact:true}),emoji=page.getByRole('button',{name:'Эмодзи',exact:true});
 expect((await attachment.boundingBox()).x).toBeLessThan((await editor.boundingBox()).x);
 expect((await emoji.boundingBox()).x).toBeGreaterThan((await editor.boundingBox()).x);
 await page.locator('#message-104').scrollIntoViewIfNeeded();
 const transcribe=page.locator('.transcribe-button').first();await expect(transcribe).toBeVisible();const box=await transcribe.boundingBox();expect(box.width).toBe(box.height);
 await page.getByRole('button',{name:'Скрыть закреплённое сообщение',exact:true}).click();await expect(editor).toBeFocused();
 const message=page.locator('#message-101');
 await message.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await message.locator('summary').first().click();await message.getByRole('button',{name:'Открепить',exact:true}).click();
 await expect(message.getByRole('button',{name:'Закрепить',exact:true,includeHidden:true})).toHaveCount(1);
 await message.locator('summary').first().click();await message.getByRole('button',{name:'Закрепить',exact:true}).click();
 await expect(page.getByRole('region',{name:'Закреплённое сообщение',exact:true})).toBeVisible();await expect(editor).toBeFocused();
 await editor.fill('Проверка фокуса');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await expect(editor).toBeFocused();await expect(editor).toHaveText('');
});
