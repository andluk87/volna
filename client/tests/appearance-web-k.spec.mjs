import {test,expect} from '@playwright/test';
const errors=new WeakMap();
test.beforeEach(async({page},info)=>{
 const failures=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.message));
 const theme=info.project.name.endsWith('-dark')?'dark':'light';
 await page.addInitScript(({theme})=>{if(!sessionStorage.getItem('appearance-test')){localStorage.clear();sessionStorage.clear();localStorage.setItem('volna.appearance',JSON.stringify({theme,animations:false}));sessionStorage.setItem('appearance-test','1');}},{theme});
 await page.goto('/app?demo=1');await page.getByRole('button',{name:'Открыть демо',exact:true}).click();
 await openAppearance(page);
});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function openAppearance(page){await page.getByLabel('Настройки и действия',{exact:true}).click();await page.getByRole('button',{name:'Внешний вид',exact:true}).click();}
async function preferences(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('volna.appearance')));}
async function reopen(page){await page.reload();const demo=page.getByRole('button',{name:'Открыть демо',exact:true});if(await demo.isVisible())await demo.click();await openAppearance(page);}
async function chat(page){await page.getByRole('button',{name:'Назад к настройкам',exact:true}).click();await page.getByRole('button',{name:'Назад к чатам',exact:true}).click();await page.locator('.chat-row').filter({hasText:'Анна Смирнова'}).first().click();}

test('Web K theme radios and text size apply live and survive reload',async({page})=>{
 await expect(page.getByRole('radiogroup',{name:'Режим темы'}).getByRole('radio')).toHaveCount(5);
 const slider=page.getByRole('slider',{name:'Размер текста',exact:true});await slider.fill('19');await expect.poll(async()=> (await preferences(page)).size).toBe(19);
 expect(await page.locator('html').evaluate(e=>e.style.getPropertyValue('--message-size'))).toBe('19px');
 await page.getByRole('radio',{name:'Тёмная',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('data-theme-variant','tinted');
 await page.getByRole('button',{name:'Цвет #d65e89',exact:true}).click();await expect.poll(async()=> (await preferences(page)).accent).toBe('#d65e89');
 await reopen(page);await expect(page.getByRole('radio',{name:'Тёмная',exact:true})).toBeChecked();await expect(page.getByRole('slider',{name:'Размер текста',exact:true})).toHaveValue('19');
 await page.getByRole('radio',{name:'Как в системе',exact:true}).check();await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('wallpaper color, upload, blur and reset use persistent local storage',async({page})=>{
 await page.getByRole('button',{name:'Фон для чатов',exact:true}).click();await expect(page.locator('.sidebar-page-head h2')).toHaveText('Фон для чатов');
 await expect(page.getByRole('switch',{name:'Размытие',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Выбрать цвет',exact:true}).click();await page.getByRole('button',{name:'Фон #f1dfe6',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-background','solid');
 await page.getByRole('button',{name:'Назад к фонам',exact:true}).click();await page.getByRole('button',{name:'Узор #d9e8df',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-background','pattern');
 await page.getByLabel('Выбрать обои',{exact:true}).setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')});
 await expect(page.locator('html')).toHaveAttribute('data-background','image');await expect.poll(()=>page.locator('html').evaluate(e=>e.style.getPropertyValue('--wallpaper-image'))).toContain('blob:');
 await page.getByRole('switch',{name:'Размытие',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-wallpaper-blur','true');
 await reopen(page);await page.getByRole('button',{name:'Фон для чатов',exact:true}).click();await expect(page.getByRole('switch',{name:'Размытие',exact:true})).toBeChecked();await expect.poll(()=>page.locator('html').evaluate(e=>e.style.getPropertyValue('--wallpaper-image'))).toContain('blob:');
 await page.getByRole('button',{name:'Сбросить фон',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-background','pattern');await expect(page.getByRole('switch',{name:'Размытие',exact:true})).not.toBeChecked();
 await page.getByLabel('Выбрать обои',{exact:true}).setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});await expect(page.getByRole('alert')).toContainText('Выберите JPEG');await expect(page.locator('html')).toHaveAttribute('data-background','pattern');
});

test('time format changes actual message and chat times',async({page})=>{
 await page.getByRole('radio',{name:/12-часовой/}).check();await chat(page);
 await expect(page.locator('.messages time').first()).toContainText(/AM|PM/);await expect(page.locator('.chat-row time').first()).toContainText(/AM|PM/);
 const back=page.getByRole('button',{name:'Назад к чатам',exact:true});if(await back.isVisible())await back.click();await openAppearance(page);await page.getByRole('radio',{name:/24-часовой/}).check();await chat(page);await expect(page.locator('.messages time').first()).not.toContainText(/AM|PM/);
});

test('power saving, keyboard navigation and extra appearance preferences work',async({page})=>{
 await page.getByRole('button',{name:'Энергосбережение',exact:true}).click();await page.getByRole('switch',{name:'Энергосбережение',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-animations','false');await expect(page.getByRole('switch',{name:'Анимации интерфейса',exact:true})).toBeDisabled();
 await page.getByRole('switch',{name:'Энергосбережение',exact:true}).uncheck();await page.getByRole('switch',{name:'Анимации интерфейса',exact:true}).check();await expect(page.locator('html')).toHaveAttribute('data-animations','true');
 await page.keyboard.press('Escape');await expect(page.locator('.sidebar-page-head h2')).toHaveText('Внешний вид');
 await page.locator('.wk-extra>summary').click();await page.getByLabel('Плотность сообщений',{exact:true}).selectOption('compact');await page.getByRole('slider',{name:'Скругление сообщений',exact:true}).fill('8');await page.getByRole('switch',{name:'Аватары в сообщениях',exact:true}).check();
 await expect(page.locator('html')).toHaveAttribute('data-density','compact');await expect.poll(async()=> (await preferences(page)).radius).toBe(8);
 await page.getByRole('button',{name:'Сбросить оформление',exact:true}).click();await expect(page.getByRole('slider',{name:'Размер текста',exact:true})).toHaveValue('16');await expect(page.getByRole('switch',{name:'Аватары в сообщениях',exact:true})).not.toBeChecked();
});
