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

test('multiple pins cycle and unpinning requires confirmation',async({page})=>{
 await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);await demoRequest('/messages/104/pin',{pinned:true},'POST');});
 await openChat(page);const banner=page.getByRole('region',{name:'Закреплённое сообщение',exact:true});await expect(banner).toContainText('Голосовое сообщение');await expect(banner).toContainText('#2');
 await banner.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();await expect(page.locator('#message-104')).toHaveClass(/message-jump-highlight/);await expect(banner).toContainText('#1');
 await banner.getByRole('button',{name:'Перейти к закреплённому сообщению',exact:true}).click();await expect(page.locator('#message-101')).toHaveClass(/message-jump-highlight/);await expect(banner).toContainText('#2');

 await banner.getByRole('button',{name:'Открепить сообщение',exact:true}).click();await page.getByRole('dialog',{name:'Открепить сообщение',exact:true}).getByRole('button',{name:'Отмена',exact:true}).click();await expect(banner).toBeVisible();
 expect(await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);return (await demoRequest('/chats/1/pins')).length;})).toBe(2);

 await banner.getByRole('button',{name:'Открепить сообщение',exact:true}).click();await page.getByRole('dialog',{name:'Открепить сообщение',exact:true}).getByRole('button',{name:'Открепить',exact:true}).click();await expect(banner).not.toContainText('#2');
 expect(await page.evaluate(async()=>{const {demoRequest}=await import(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/demo-api.mjs').at(-1).name);return (await demoRequest('/chats/1/pins')).length;})).toBe(1);
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

test('repinning restores the banner immediately and composer stays ready',async({page})=>{
 await openChat(page);
 const editor=page.getByRole('textbox',{name:'Сообщение',exact:true});await expect(editor).toBeFocused();
 const attachment=page.getByLabel('Прикрепить вложение',{exact:true}),emoji=page.getByRole('button',{name:'Эмодзи',exact:true});
 expect((await attachment.boundingBox()).x).toBeLessThan((await editor.boundingBox()).x);
 expect((await emoji.boundingBox()).x).toBeGreaterThan((await editor.boundingBox()).x);
 await page.locator('#message-104').scrollIntoViewIfNeeded();
 const transcribe=page.locator('.transcribe-button').first();await expect(transcribe).toBeVisible();const box=await transcribe.boundingBox();expect(box.width).toBe(box.height);

 await page.getByRole('button',{name:'Открепить сообщение',exact:true}).click();await page.getByRole('dialog',{name:'Открепить сообщение',exact:true}).getByRole('button',{name:'Открепить',exact:true}).click();await expect(page.getByRole('region',{name:'Закреплённое сообщение',exact:true})).toHaveCount(0);await expect(editor).toBeFocused();
 const message=page.locator('#message-101');
 await message.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(message.getByRole('button',{name:'Закрепить',exact:true,includeHidden:true})).toHaveCount(1);
 await message.locator('summary').first().click();await message.getByRole('button',{name:'Закрепить',exact:true}).click();
 await expect(page.getByRole('region',{name:'Закреплённое сообщение',exact:true})).toBeVisible();await expect(editor).toBeFocused();
 await editor.fill('Проверка фокуса');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await expect(editor).toBeFocused();await expect(editor).toHaveText('');
});

test('emoji popup opens above the composer on the right within the chat',async({page})=>{
 await openChat(page);
 const history=page.locator('.messages'),composer=page.locator('.composer'),panel=page.getByRole('region',{name:'Выбор эмодзи',exact:true}),editor=page.getByRole('textbox',{name:'Сообщение',exact:true});
 const initialHeight=(await history.boundingBox()).height;
 await page.getByRole('button',{name:'Эмодзи',exact:true}).click();await expect(panel).toBeVisible();
 const pickerBox=await panel.boundingBox(),chatBox=await page.locator('.conversation').boundingBox(),historyBox=await history.boundingBox(),inputBox=await composer.boundingBox();
 expect(pickerBox.x).toBeGreaterThanOrEqual(chatBox.x);expect(pickerBox.x+pickerBox.width).toBeLessThanOrEqual(chatBox.x+chatBox.width+1);
 expect(pickerBox.y+pickerBox.height).toBeLessThanOrEqual(inputBox.y);expect(pickerBox.x+pickerBox.width).toBeCloseTo(inputBox.x+inputBox.width,0);expect(historyBox.y+historyBox.height).toBeLessThanOrEqual(inputBox.y+1);
 expect(pickerBox.y).toBeGreaterThanOrEqual(chatBox.y);expect(historyBox.height).toBeGreaterThan(80);
 expect(historyBox.height).toBe(initialHeight);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const search=page.getByRole('textbox',{name:'Найти эмодзи',exact:true});await search.fill('улыб');await expect(search).toBeFocused();await search.fill('');
 await panel.locator('.unicode-choice').first().click();await expect(editor).not.toHaveText('');await expect(panel).toBeVisible();
 await page.getByRole('button',{name:'Закрыть эмодзи',exact:true}).click();await expect(panel).toHaveCount(0);await expect(editor).toBeFocused();
 expect((await history.boundingBox()).height).toBe(initialHeight);
});

test('main menu keeps working actions in a compact More submenu',async({page})=>{
 await page.getByLabel('Настройки и действия',{exact:true}).click();const menu=page.locator('.main-menu>.app-menu-content');await expect(menu).toBeVisible();
 await expect(menu.getByRole('button',{name:'Избранное',exact:true})).toBeVisible();await expect(menu.getByRole('button',{name:'Архив',exact:true})).toBeVisible();await expect(menu.getByRole('button',{name:'Контакты',exact:true})).toBeVisible();
 await menu.getByLabel('Ещё',{exact:true}).click();const more=page.locator('.main-menu-more>div');await expect(more).toBeVisible();
 const box=await more.boundingBox();expect(await more.evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.right-10,rect.top+20));})).toBe(true);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
 await more.getByRole('button',{name:'Без анимации',exact:true}).or(more.getByRole('button',{name:'Включить анимацию',exact:true})).click();await expect(menu).not.toBeVisible();
 await page.getByLabel('Настройки и действия',{exact:true}).click();await menu.getByRole('button',{name:'Настройки',exact:true}).click();await expect(page.locator('.sidebar-page-head h2')).toHaveText('Настройки');
});

test('attachment menu sends polls, shared checklists and music without a wallet',async({page})=>{
 await openChat(page);const menu=page.locator('.attach-menu .app-menu-content');
 await page.getByLabel('Прикрепить вложение',{exact:true}).click();await expect(menu).toBeVisible();
 for(const name of ['Фото или видео','Файл','Музыка','Опрос','Список'])await expect(menu.getByRole('button',{name,exact:true})).toBeVisible();await expect(menu).not.toContainText('Кошелёк');
 await menu.getByRole('button',{name:'Опрос',exact:true}).click();const pollDialog=page.getByRole('dialog',{name:'Новый опрос',exact:true});await expect(pollDialog).toBeVisible();
 await pollDialog.getByLabel('Вопрос опроса',{exact:true}).fill('Когда встречаемся?');await pollDialog.getByLabel('Вариант ответа 1',{exact:true}).fill('Сегодня');await pollDialog.getByLabel('Вариант ответа 2',{exact:true}).fill('Завтра');await pollDialog.getByRole('button',{name:'Отправить опрос',exact:true}).click();await expect(pollDialog).toHaveCount(0);
 const poll=page.getByRole('region',{name:'Опрос',exact:true}).filter({hasText:'Когда встречаемся?'});await expect(poll).toBeVisible();await poll.getByRole('button',{name:/Сегодня/}).click();await expect(poll).toContainText('1 голосов');await poll.getByRole('button',{name:'Отменить голос',exact:true}).click();await expect(poll).toContainText('0 голосов');
 await page.getByLabel('Прикрепить вложение',{exact:true}).click();await menu.getByRole('button',{name:'Список',exact:true}).click();const listDialog=page.getByRole('dialog',{name:'Новый список',exact:true});await listDialog.getByLabel('Название списка',{exact:true}).fill('Покупки');await listDialog.getByLabel('Пункт списка 1',{exact:true}).fill('Хлеб');await listDialog.getByRole('button',{name:'Добавить пункт',exact:true}).click();await listDialog.getByLabel('Пункт списка 2',{exact:true}).fill('Молоко');await listDialog.getByRole('button',{name:'Отправить список',exact:true}).click();await expect(listDialog).toHaveCount(0);
 const checklist=page.getByRole('region',{name:'Список',exact:true});await checklist.getByRole('checkbox',{name:'Хлеб',exact:true}).check();await expect(checklist).toContainText('Выполнено 1 из 2');
 await back(page);await openChat(page,'Дизайн Волны');await back(page);await openChat(page);await expect(checklist.getByRole('checkbox',{name:'Хлеб',exact:true})).toBeChecked();
 await page.getByLabel('Прикрепить вложение',{exact:true}).click();const choosing=page.waitForEvent('filechooser');await menu.getByRole('button',{name:'Музыка',exact:true}).click();await (await choosing).setFiles({name:'Песня.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFF0000WAVEfmt ')});await expect(page.locator('.draft-context')).toContainText('Песня.wav');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await expect(page.locator('.draft-context')).toHaveCount(0);await expect(page.locator('.audio-title').filter({hasText:'Песня.wav'})).toBeVisible();
});
