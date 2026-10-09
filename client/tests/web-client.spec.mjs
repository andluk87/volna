import {test,expect} from '@playwright/test';
const failures=new WeakMap();
test.beforeEach(async({page},info)=>{
 const errors=[];failures.set(page,errors);page.on('pageerror',e=>errors.push(e.message));
 const theme=info.project.name.endsWith('-dark')?'dark':'light';
 await page.addInitScript(({theme})=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('volna.appearance',JSON.stringify({theme,font:'system',size:16,density:'standard',radius:15,accent:'#3390ec',background:'pattern',animations:false,avatars:false,time:'always'}));},{theme});
 await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
 await page.goto('/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();
 await expect(page.locator('.chat-row')).toHaveCount(23); // one archived chat
 await page.evaluate(()=>document.fonts.ready);
});
test.afterEach(async({page})=>{expect(failures.get(page)).toEqual([]);});
async function openChat(page,name='Анна Смирнова'){await page.locator('.chat-row').filter({hasText:name}).first().click();await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toBeVisible();await expect(page.locator('.messages article.message')).toHaveCount(12);}
async function shot(page,name){await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBeTruthy();await expect(page).toHaveScreenshot(name+'.png');}
async function menu(page){await page.getByLabel('Настройки и действия',{exact:true}).click();}
async function sidebar(page){const back=page.getByRole('button',{name:'Назад к чатам',exact:true});if(await back.isVisible())await back.click();}

test('геометрия, пустой экран, сообщение, медиа и групповая переписка',async({page})=>{
 const width=page.viewportSize().width;
 await expect(page.getByRole('tablist',{name:'Папки чатов'})).toHaveCount(0);await shot(page,'empty');
 const row=await page.locator('.chat-row').first().boundingBox(),avatar=await page.locator('.chat-row .avatar').first().boundingBox();expect(row.height).toBe(72);expect(avatar.width).toBe(54);expect(avatar.height).toBe(54);
 await openChat(page);const bounds=await page.locator('.messages-content').boundingBox();expect(bounds.width).toBeLessThanOrEqual(696);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await shot(page,'chat');
 const editor=page.getByRole('textbox',{name:'Сообщение',exact:true});await editor.fill('Короткий текст');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 const last=page.locator('.message.outgoing').last();await expect(last).toContainText('Короткий текст');await expect(last.locator('.message-inline-meta time')).toBeVisible();const short=await last.boundingBox();expect(short.height).toBeLessThan(45);
 const editbox=await page.locator('.composer-surface').boundingBox(),sendbox=await page.locator('.composer>.mic-button').boundingBox();expect(sendbox.x).toBeGreaterThanOrEqual(editbox.x+editbox.width+6);await shot(page,'short-message');
 await page.locator('.messages').evaluate(el=>el.scrollTop=0);await expect(page.locator('.messages .image-open img').first()).toBeVisible();await expect(page.locator('.voice-wave i')).toHaveCount(48);await shot(page,'media');
 await sidebar(page);await openChat(page,'Дизайн Волны');await expect(page.getByRole('region',{name:'Опрос'})).toBeVisible();await shot(page,'group');
 expect(width>0).toBe(true);
});

test('меню, профиль, оформление, поиск, контекстное меню и эмодзи',async({page})=>{
 await menu(page);await shot(page,'main-menu');await page.getByRole('button',{name:'Внешний вид',exact:true}).click();await expect(page.locator('.appearance-inline')).toBeVisible();await shot(page,'appearance');
 await page.getByRole('button',{name:'Назад к настройкам',exact:true}).click();await expect(page.locator('.settings-account')).toBeVisible();await shot(page,'settings');await page.getByRole('button',{name:'Назад к чатам',exact:true}).click();
 await page.getByRole('textbox',{name:'Поиск пользователей и чатов'}).fill('Анна');await expect(page.getByRole('tablist',{name:'Результаты поиска'})).toBeVisible();await shot(page,'search');await page.getByRole('button',{name:'Закрыть поиск'}).click();
 await openChat(page);await page.getByRole('button',{name:'Информация о чате',exact:true}).click();await expect(page.locator('.info-panel')).toBeVisible();await shot(page,'profile');await page.getByRole('button',{name:'Закрыть информацию'}).click();
 await page.locator('.message').last().click({button:'right'});await expect(page.locator('.message-actions[open]')).toHaveCount(1);await shot(page,'context-menu');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Эмодзи',exact:true}).click();await expect(page.locator('.emoji-panel')).toBeVisible();await shot(page,'emoji');
});

test('отправка, перенос строки, ответ, реакция, редактирование и удаление',async({page})=>{
 await openChat(page);const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Первая строка');await input.press('Shift+Enter');await input.pressSequentially('Вторая строка');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 let sent=page.locator('.message.outgoing').last();await expect(sent).toContainText('Первая строка\nВторая строка');await sent.click({button:'right'});await page.locator('.message-actions[open]').getByRole('button',{name:'Ответить',exact:true}).click();await expect(page.locator('.draft-context')).toContainText('Ответ');
 await input.fill('Ответ на сообщение');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();sent=page.locator('.message.outgoing').last();await expect(sent.locator('.reply-quote')).toContainText('Первая строка');
 await sent.click({button:'right'});await page.locator('.message-actions[open]').getByRole('button',{name:'Реакция 👍',exact:true}).click();await expect(sent.locator('.reactions')).toContainText('👍');
 await sent.click({button:'right'});await page.locator('.message-actions[open]').getByRole('button',{name:'Редактировать',exact:true}).click();await input.fill('Исправленный ответ');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(sent).toContainText('изменено');
 await sent.click({button:'right'});await page.locator('.message-actions[open]').getByRole('button',{name:'Удалить у всех',exact:true}).click();await page.getByRole('dialog',{name:'Удалить сообщение'}).getByRole('button',{name:'Удалить',exact:true}).click();await expect(sent).toContainText('Сообщение удалено');
});

test('папки создаются, переименовываются и удаляются; голос опроса меняется',async({page})=>{
 await menu(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Папки чатов',exact:true}).click();await page.getByRole('button',{name:'Создать папку'}).click();await page.getByLabel('Название папки').fill('Работа');await page.locator('.folder-chat-selection').getByText('Дизайн Волны',{exact:true}).click();await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.folder-setting-row>button').first().click();await page.getByLabel('Название папки').fill('Проект');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('button',{name:'Назад к настройкам',exact:true}).click();await page.getByRole('button',{name:'Назад к чатам',exact:true}).click();await page.getByRole('tab',{name:'Проект',exact:true}).click();await expect(page.locator('.chat-row')).toHaveCount(1);
 await openChat(page,'Дизайн Волны');const poll=page.locator('.poll-message');await poll.getByRole('button',{name:/Компактный/}).click();await expect(poll.getByRole('button',{name:/Компактный/})).toHaveAttribute('aria-pressed','true');await poll.getByRole('button',{name:/Стандартный/}).click();await expect(poll.getByRole('button',{name:/Компактный/})).toHaveAttribute('aria-pressed','false');await poll.getByRole('button',{name:'Отменить голос'}).click();await expect(poll.getByRole('button',{name:/Стандартный/})).toHaveAttribute('aria-pressed','false');
 await sidebar(page);await menu(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Папки чатов',exact:true}).click();await page.getByRole('button',{name:'Удалить папку Проект'}).click();await page.getByRole('button',{name:'Назад к настройкам',exact:true}).click();await page.getByRole('button',{name:'Назад к чатам',exact:true}).click();await expect(page.getByRole('tablist',{name:'Папки чатов'})).toHaveCount(0);
});

test('темы сохраняются, редактор без рамки, эмодзи вставляются и удаляются целиком',async({page})=>{
 await menu(page);await page.getByRole('button',{name:'Внешний вид',exact:true}).click();
 await page.locator('.theme-presets').getByRole('button',{name:'Ночная',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('volna.appearance')).accent)).toBe('#8774e1');
 await page.getByRole('button',{name:'Назад к настройкам',exact:true}).click();await page.getByRole('button',{name:'Назад к чатам',exact:true}).click();
 await openChat(page);const editor=page.getByRole('textbox',{name:'Сообщение',exact:true});await editor.fill('Привет ');await editor.focus();expect(await editor.evaluate(e=>getComputedStyle(e).outlineStyle)).toBe('none');
 await page.getByRole('button',{name:'Эмодзи',exact:true}).click();const panel=page.getByRole('region',{name:'Выбор эмодзи'});await expect(panel).toBeVisible();await panel.getByRole('button',{name:'Люди',exact:true}).click();await panel.getByLabel('Тон кожи эмодзи').selectOption('🏽');await panel.getByRole('button',{name:'да класс thumb yes 👍🏽',exact:true}).click();await expect(editor).toContainText('👍🏽');
 await panel.getByRole('button',{name:'Удалить предыдущий символ'}).click();await expect(editor).not.toContainText('👍');await expect(editor).toContainText('Привет');
 await panel.getByRole('button',{name:'Настроить эмодзи'}).click();await expect(panel.getByRole('button',{name:'Очистить недавние'})).toBeVisible();await panel.getByRole('button',{name:'Закрыть эмодзи'}).click();await expect(panel).toHaveCount(0);
});
