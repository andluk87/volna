export const defaults={theme:'system',size:16,font:'system',density:'standard',radius:15,accent:'#3390ec',background:'pattern',backgroundColor:'#dfe9dc',animations:true,avatars:false,time:'always',themeVariant:'system',timeFormat:'24',blur:false,powerSaving:false};
export const fonts={system:'Roboto, -apple-system, "Segoe UI", sans-serif',neutral:'Arial, Helvetica, sans-serif',compact:'Tahoma, Verdana, sans-serif'};
export function normalizeAppearance(value={}){
 const v=value&&typeof value==='object'?value:{};
 const variantThemes={day:'light',night:'dark',light:'light',tinted:'dark',system:'system'};
 const inferred=v.theme==='dark'?'night':v.theme==='light'?'day':'system';
 const variant=Object.hasOwn(variantThemes,v.themeVariant)&&variantThemes[v.themeVariant]===v.theme?v.themeVariant:inferred;
 const choice=(key,values)=>values.includes(v[key])?v[key]:defaults[key];
 return {themeVariant:variant,timeFormat:choice('timeFormat',['12','24']),blur:v.blur===true,powerSaving:v.powerSaving===true,background:choice('background',['solid','pattern','image']),backgroundColor:/^#[a-f\d]{6}$/i.test(v.backgroundColor||'')?v.backgroundColor:defaults.backgroundColor,animations:v.animations!==false,theme:choice('theme',['light','dark','system']),size:Number.isFinite(v.size)?Math.min(20,Math.max(12,v.size)):16,font:choice('font',Object.keys(fonts)),density:choice('density',['minimal','compact','standard','large']),radius:Number.isFinite(v.radius)?Math.min(30,Math.max(0,v.radius)):15,accent:/^#[a-f\d]{6}$/i.test(v.accent||'')?v.accent:defaults.accent,avatars:v.avatars===true,time:choice('time',['always','hover'])};
}
export function accentText(hex){const rgb=hex.slice(1).match(/../g).map(c=>{const v=parseInt(c,16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#10202b':'#ffffff';}

export const themePresets=[
 {id:'classic',name:'Классическая',theme:'light',accent:'#3390ec',backgroundColor:'#dfe9dc'},
 {id:'day',name:'Дневная',theme:'light',accent:'#3390ec',backgroundColor:'#dce7f0'},
 {id:'night',name:'Ночная',theme:'dark',accent:'#8774e1',backgroundColor:'#181522'},
 {id:'dark',name:'Тёмная',theme:'dark',accent:'#3390ec',backgroundColor:'#0f0f0f'},
 {id:'mint',name:'Мята',theme:'light',accent:'#2ead88',backgroundColor:'#d9e8df'},
 {id:'rose',name:'Розовая',theme:'light',accent:'#d65e89',backgroundColor:'#f1dfe6'}
];
export function presetPatch(id){const preset=themePresets.find(p=>p.id===id);if(!preset)return {};const {name,id:ignored,...patch}=preset;return {...patch,themeVariant:preset.theme==='dark'?(id==='dark'?'tinted':'night'):(id==='day'?'light':'day'),background:'pattern'};}

// The theme variants mirror General Settings in Web K; legacy light/dark values remain valid.
export const themeVariants=[
 {id:'day',name:'Классическая',theme:'light',accent:'#3390ec',backgroundColor:'#dfe9dc'},
 {id:'night',name:'Ночная',theme:'dark',accent:'#8774e1',backgroundColor:'#0f0f0f'},
 {id:'light',name:'Дневная',theme:'light',accent:'#3390ec',backgroundColor:'#dce7f0'},
 {id:'tinted',name:'Тёмная',theme:'dark',accent:'#5288c1',backgroundColor:'#17212b'},
 {id:'system',name:'Как в системе',theme:'system',accent:'#3390ec',backgroundColor:'#dfe9dc'}
];
export function themeVariantPatch(id){const variant=themeVariants.find(v=>v.id===id);if(!variant)return {};const {name,id:themeVariant,...patch}=variant;return {...patch,themeVariant,background:'pattern'};}
export function formatTime(value,format='24'){
 if(!value)return '';
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return '';
 return date.toLocaleTimeString(format==='12'?'en-US':'ru-RU',{hour:'2-digit',minute:'2-digit',hour12:format==='12'});
}
export const wallpaperColors=['#dfe9dc','#dce7f0','#e6d9f0','#f1dfe6','#f4e2ce','#d9e8df','#b9d5c7','#c2d1e9','#d8c4e5','#e8bfc9','#e6c79d','#b8c9b2','#ffffff','#707579','#212121','#17212b','#181522','#0f0f0f'];
