import React,{useState,useEffect} from 'react';
import {defaults,fonts,normalizeAppearance,accentText,themePresets,presetPatch,themeVariants,themeVariantPatch,wallpaperColors,formatTime} from './appearance.mjs';
import {Icon,Avatar} from './ui';
import AudioPlayer from './AudioPlayer';
import Dialog from './Dialog';
import {wallpaperBlob,saveWallpaper} from './background.mjs';
export function useAppearance(){
 const [settings,setSettings]=useState(()=>{try{const raw=localStorage.getItem('volna.appearance');return normalizeAppearance(raw?JSON.parse(raw):{theme:localStorage.getItem('volna.theme')||'system',...(window.volnaDesktop?{size:14,radius:8}:{})});}catch{return {...defaults};}});
 const [wallpaperRevision,setWallpaperRevision]=useState(0);
 useEffect(()=>{const changed=()=>setWallpaperRevision(v=>v+1);window.addEventListener('volna-wallpaper',changed);return()=>window.removeEventListener('volna-wallpaper',changed);},[]);
 useEffect(()=>{let live=true,url;document.documentElement.style.removeProperty('--wallpaper-image');if(settings.background==='image')wallpaperBlob().then(blob=>{if(live&&blob){url=URL.createObjectURL(blob);document.documentElement.style.setProperty('--wallpaper-image',`url("${url}")`);}}).catch(()=>{});return()=>{live=false;if(url)URL.revokeObjectURL(url);};},[settings.background,wallpaperRevision]);
 const [saveError,setSaveError]=useState(false);
 useEffect(()=>{const root=document.documentElement,media=matchMedia('(prefers-color-scheme: dark)');const apply=()=>{const resolved=settings.theme==='system'?(media.matches?'dark':'light'):settings.theme;root.dataset.theme=resolved;const accent=window.volnaDesktop&&settings.accent===defaults.accent?(resolved==='dark'?'#5288c1':'#419fd9'):settings.theme==='system'&&resolved==='dark'&&settings.accent===defaults.accent?'#8774e1':settings.accent;root.style.setProperty('--accent',accent);root.style.setProperty('--accent-ink',accentText(accent));};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[settings.theme,settings.accent]);
 useEffect(()=>{const r=document.documentElement;r.dataset.background=settings.background;r.dataset.animations=String(settings.animations&&!settings.powerSaving);r.dataset.themeVariant=settings.themeVariant;r.dataset.wallpaperBlur=String(settings.blur);r.style.setProperty('--wallpaper-color',settings.backgroundColor);r.style.setProperty('--dark-wallpaper-color',settings.backgroundColor===defaults.backgroundColor?(window.volnaDesktop?'#0e1621':'#0f0f0f'):settings.backgroundColor);r.dataset.density=settings.density;r.dataset.messageTime=settings.time;r.dataset.avatars=String(settings.avatars);r.style.setProperty('--message-size',settings.size+'px');r.style.setProperty('--app-font',window.volnaDesktop&&settings.font==='system'?'"Segoe UI", Roboto, sans-serif':fonts[settings.font]);r.style.setProperty('--bubble-radius',settings.radius+'px');r.style.setProperty('--custom-out',settings.accent===defaults.accent?'#eeffde':`color-mix(in srgb, ${settings.accent} 16%, white)`);try{localStorage.setItem('volna.appearance',JSON.stringify(settings));setSaveError(false);}catch{setSaveError(true);}},[settings]);
 return [settings,patch=>setSettings(current=>normalizeAppearance({...current,...patch})),saveError];
}
export const appearancePages={main:'Внешний вид',background:'Фон для чатов',color:'Выбрать цвет',power:'Энергосбережение'};

function Section({title,children,className=''}){
 return <section className={'wk-section '+className}>{title&&<h3>{title}</h3>}{children}</section>;
}
function Row({icon,label,value,onClick}){
 return <button type="button" className="wk-row" aria-label={label} onClick={onClick}>{icon&&<Icon name={icon}/>}<span>{label}</span>{value&&<small>{value}</small>}</button>;
}
function Radio({name,value,checked,onChange,label,subtitle}){
 return <label className={'wk-radio-row'+(subtitle?' with-subtitle':'')}><input type="radio" name={name} value={value} checked={checked} onChange={onChange}/><span className="wk-radio-mark"/><span className="wk-radio-copy"><span>{label}</span>{subtitle&&<small>{subtitle}</small>}</span></label>;
}
function Toggle({label,subtitle,checked,onChange,disabled=false}){
 return <label className={'wk-toggle-row'+(disabled?' disabled':'')}><span>{label}{subtitle&&<small>{subtitle}</small>}</span><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled}/><span className="wk-switch"/></label>;
}
function Range({label,value,min,max,onChange}){
 return <label className="wk-range"><span>{label}<output>{value}</output></span><input aria-label={label} type="range" min={min} max={max} step="1" value={value} style={{'--range-progress':((value-min)/(max-min)*100)+'%'}} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function ThemeTiles({settings,onChange}){
 return <div className="theme-presets wk-theme-strip" aria-label="Готовые темы">{themePresets.map(p=><button type="button" key={p.id} aria-pressed={settings.theme===p.theme&&settings.accent===p.accent&&settings.backgroundColor===p.backgroundColor} onClick={()=>onChange(presetPatch(p.id))}><span className="theme-miniature" style={{backgroundColor:p.backgroundColor,'--theme-panel':p.theme==='dark'?'#212121':'#fff','--theme-accent':p.accent}}><i/><i/><i/><span className="wk-theme-check"><Icon name="check"/></span></span><span>{p.name}</span></button>)}</div>;
}
function Preview({settings}){
 return <div className="appearance-preview wk-preview" aria-label="Предпросмотр оформления"><div className="preview-messages"><article className="message incoming"><span className="preview-avatar">{settings.avatars&&<Avatar name="Анна" id={2}/>}</span><div className="message-text">Привет! Как тебе новый вид Волны?</div><span className="message-meta">{formatTime('2026-10-09T12:40:00',settings.timeFormat)}</span></article><article className="message outgoing"><div className="message-text">Всё важное под рукой.</div><span className="message-meta">{formatTime('2026-10-09T12:41:00',settings.timeFormat)} <Icon name="check"/></span></article><article className="message incoming media-voice"><AudioPlayer url="./appearance-sample.wav" name="Пример аудио" voice/></article></div></div>;
}
export default function Appearance({settings,onChange,onClose,saveError,inline=false,page:controlledPage,onNavigate}){
 const [localPage,setLocalPage]=useState('main'),[wallpaperError,setWallpaperError]=useState('');
 const page=controlledPage??localPage,navigate=onNavigate??setLocalPage;
 const upload=React.useRef(null),content=React.useRef(null);
 const [now,setNow]=useState(()=>new Date());
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{const scroll=content.current?.closest('.sidebar-page-scroll');if(scroll)scroll.scrollTop=0;},[page]);
 async function chooseWallpaper(file){if(!file)return;try{await saveWallpaper(file);onChange({background:'image'});setWallpaperError('');}catch(e){setWallpaperError(e.message);}}
 async function resetBackground(){try{await saveWallpaper(null);const variant=themeVariantPatch(settings.themeVariant);onChange({background:'pattern',backgroundColor:variant.backgroundColor||defaults.backgroundColor,blur:false});setWallpaperError('');}catch(e){setWallpaperError(e.message);}}
 const select=(label,key,options)=><label className="wk-select">{label}<select aria-label={label} value={settings[key]} onChange={e=>onChange({[key]:e.target.value})}>{options.map(([value,text])=><option value={value} key={value}>{text}</option>)}</select></label>;
 const body=<div ref={content} className="appearance-inline wk-appearance" data-page={page}>
 {page==='main'?<>
  <Section title="Настройки">
   <Range label="Размер текста" value={settings.size} min={12} max={20} onChange={size=>onChange({size})}/>
   <Row icon="appearance" label="Фон для чатов" onClick={()=>navigate('background')}/>
   <Row icon="power" label="Энергосбережение" value={settings.powerSaving?'Включено':'Выключено'} onClick={()=>navigate('power')}/>
  </Section>
  <Section title="Цветовая тема">
   <ThemeTiles settings={settings} onChange={onChange}/>
   <div role="radiogroup" aria-label="Режим темы">{themeVariants.map(v=><Radio key={v.id} name="appearance-theme" value={v.id} checked={settings.themeVariant===v.id} onChange={()=>onChange(themeVariantPatch(v.id))} label={v.name}/>)}</div>
   {settings.themeVariant==='tinted'&&<div className="wk-accent-picker" aria-label="Акцентный цвет">{['#5288c1','#8774e1','#a76fc1','#d65e89','#d77d43','#2ead88'].map(accent=><button type="button" key={accent} aria-label={'Цвет '+accent} aria-pressed={settings.accent===accent} style={{'--swatch':accent}} onClick={()=>onChange({accent})}><span/></button>)}</div>}
  </Section>
  <Section title="Формат времени"><div role="radiogroup" aria-label="Формат времени">{[['12','12-часовой'],['24','24-часовой']].map(([format,label])=><Radio key={format} name="appearance-time" value={format} checked={settings.timeFormat===format} onChange={()=>onChange({timeFormat:format})} label={label} subtitle={formatTime(now,format)}/>)}</div></Section>
  <details className="wk-extra"><summary>Дополнительное оформление Волны<Icon name="down"/></summary><Section>
   {select('Шрифт','font',[['system','Roboto'],['neutral','Arial'],['compact','Tahoma']])}
   {select('Плотность сообщений','density',[['minimal','Максимально компактная'],['compact','Компактная'],['standard','Стандартная'],['large','Свободная']])}
   <Range label="Скругление сообщений" value={settings.radius} min={0} max={30} onChange={radius=>onChange({radius})}/>
   <label className="wk-color-input">Акцентный цвет<input aria-label="Акцентный цвет" type="color" value={settings.accent} onChange={e=>onChange({accent:e.target.value})}/></label>
   {select('Время сообщений','time',[['always','Всегда'],['hover','При наведении или нажатии']])}
   <Toggle label="Аватары в сообщениях" checked={settings.avatars} onChange={avatars=>onChange({avatars})}/>
   <Preview settings={settings}/>
   <Row icon="history" label="Сбросить оформление" onClick={()=>onChange(defaults)}/>
  </Section></details>
 </>:page==='power'?<>
  <Section><Toggle label="Энергосбережение" subtitle="Отключает анимации интерфейса" checked={settings.powerSaving} onChange={powerSaving=>onChange({powerSaving})}/></Section>
  <Section title="Анимации"><Toggle label="Анимации интерфейса" checked={settings.animations} disabled={settings.powerSaving} onChange={animations=>onChange({animations})}/></Section>
 </>:page==='background'?<>
  <Section>
   <Row icon="uploadWallpaper" label="Загрузить обои" onClick={()=>upload.current?.click()}/>
   <input ref={upload} className="wk-file-input" type="file" aria-label="Выбрать обои" accept="image/png,image/jpeg,image/webp" onChange={e=>{chooseWallpaper(e.target.files[0]);e.target.value='';}}/>
   <Row icon="palette" label="Выбрать цвет" onClick={()=>navigate('color')}/>
   <Row icon="resetWallpaper" label="Сбросить фон" onClick={resetBackground}/>
   <Toggle label="Размытие" checked={settings.blur} disabled={settings.background!=='image'} onChange={blur=>onChange({blur})}/>
  </Section>
  <Section className="wk-wallpapers"><div className="wk-wallpaper-grid" aria-label="Фоны для чатов">{wallpaperColors.map(color=><button type="button" key={color} aria-label={'Узор '+color} aria-pressed={settings.background==='pattern'&&settings.backgroundColor===color} style={{backgroundColor:color}} onClick={()=>onChange({background:'pattern',backgroundColor:color,blur:false})}><span className="wk-wallpaper-check"><Icon name="check"/></span></button>)}</div></Section>
  <Preview settings={settings}/>
 </>:<>
  <Section><div className="wk-color-grid" aria-label="Цвета фона">{wallpaperColors.map(color=><button type="button" key={color} aria-label={'Фон '+color} aria-pressed={settings.background==='solid'&&settings.backgroundColor===color} style={{backgroundColor:color}} onClick={()=>onChange({background:'solid',backgroundColor:color,blur:false})}><Icon name="check"/></button>)}</div><label className="wk-color-input">Свой цвет<input aria-label="Цвет фона" type="color" value={settings.backgroundColor} onChange={e=>onChange({background:'solid',backgroundColor:e.target.value,blur:false})}/></label></Section>
  <Preview settings={settings}/>
 </>}
 {wallpaperError&&<p className="wk-settings-error" role="alert">{wallpaperError}</p>}
 {saveError&&<p className="wk-settings-error" role="alert">Хранилище недоступно. Настройки действуют до перезагрузки.</p>}
 </div>;
 if(inline)return body;
 return <Dialog title={appearancePages[page]} onClose={onClose} className="appearance-dialog wk-appearance-dialog">{page!=='main'&&<button className="wk-modal-back" onClick={()=>navigate(page==='color'?'background':'main')}><Icon name="back"/>Назад</button>}{body}</Dialog>;
}
