export function parseMessage(text=''){
 const lines=String(text).split('\n'),blocks=[];let paragraph=[],quote=[],code=null;
 const flushParagraph=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
 const flushQuote=()=>{if(quote.length){blocks.push({type:'quote',text:quote.join('\n')});quote=[];}};
 for(const line of lines){
  const fence=line.match(/^```([\w+#.-]{0,20})\s*$/);
  if(fence){if(code){blocks.push({type:'code',text:code.lines.join('\n'),language:code.language});code=null;}else{flushParagraph();flushQuote();code={language:fence[1],lines:[]};}continue;}
  if(code){code.lines.push(line);continue;}
  if(/^> ?/.test(line)){flushParagraph();quote.push(line.replace(/^> ?/,''));continue;}
  flushQuote();if(!line.trim()){flushParagraph();continue;}paragraph.push(line);
 }
 if(code)blocks.push({type:'code',text:['```'+code.language,...code.lines].join('\n'),language:''});
 flushParagraph();flushQuote();return blocks;
}

// Only explicit, safe inline constructs become React nodes. Arbitrary HTML stays text.
const inlinePattern=/(<u>[^\n]+?<\/u>|\|\|[^\n]+?\|\||__[^_\n]+__|\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
export function parseInline(text=''){
 const output=[];let last=0;const pattern=new RegExp(inlinePattern.source,'g');
 for(const match of text.matchAll(pattern)){if(match.index>last)output.push({type:'text',text:text.slice(last,match.index)});const raw=match[0];
  if(raw.startsWith('<u>'))output.push({type:'underline',text:raw.slice(3,-4)});
  else if(raw.startsWith('||'))output.push({type:'spoiler',text:raw.slice(2,-2)});
  else if(raw.startsWith('__'))output.push({type:'em',text:raw.slice(2,-2)});
  else if(raw.startsWith('**'))output.push({type:'strong',text:raw.slice(2,-2)});
  else if(raw.startsWith('~~'))output.push({type:'del',text:raw.slice(2,-2)});
  else if(raw.startsWith('*')||raw.startsWith('_'))output.push({type:'em',text:raw.slice(1,-1)});
  else if(raw.startsWith('`'))output.push({type:'inline-code',text:raw.slice(1,-1)});
  else{const link=raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);output.push({type:'link',text:link[1],href:link[2]});}
  last=match.index+raw.length;
 }
 if(last<text.length)output.push({type:'text',text:text.slice(last)});return output;
}

export const formattingOptions=[['bold','Жирный','B'],['italic','Курсив','I'],['underline','Подчёркнутый','U'],['strike','Зачёркнутый','S̶'],['inline','Моноширинный','`·`'],['code','Блок кода','</>'],['spoiler','Спойлер','◧'],['quote','Цитата','❞'],['link','Гиперссылка','↗']];
export function formatSelection(value,entities,start,end,kind,option=''){
 start=Math.max(0,Math.min(value.length,start));end=Math.max(start,Math.min(value.length,end));
 const selected=value.slice(start,end)||'текст';let before='',after='',content=selected;
 if(kind==='link'){
  let url;try{url=new URL(option);}catch{throw Error('Введите полный адрес: https://example.org');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Ссылка должна начинаться с http:// или https://');
  before='[';after=']('+url.href.replaceAll('(','%28').replaceAll(')','%29')+')';
 }else if(kind==='quote'){before=start===0||value[start-1]==='\n'?'':'\n';content=selected.split('\n').map(line=>'> '+line).join('\n');}
 else if(kind==='code'){if(!/^[\w+#.-]{0,20}$/.test(option))throw Error('Укажите язык кода, например js или python');before=(start===0||value[start-1]==='\n'?'':'\n')+'```'+option+'\n';after='\n```'+(end===value.length||value[end]==='\n'?'':'\n');}
 else{const markers={bold:['**','**'],italic:['__','__'],underline:['<u>','</u>'],strike:['~~','~~'],inline:['`','`'],spoiler:['||','||']}[kind];if(!markers)throw Error('Неизвестный формат');[before,after]=markers;}
 const multiline=!['quote','code'].includes(kind)&&content.includes('\n');if(multiline)content=content.split('\n').join(after+'\n'+before);
 const text=value.slice(0,start)+before+content+after+value.slice(end),delta=text.length-value.length;
 if(text.length>4000)throw Error('Форматирование превышает лимит сообщения');
 const mapped=entities.map(entity=>{if(entity.start>=end)return {...entity,start:entity.start+delta};if(entity.start<start)return entity;return {...entity,start:entity.start+before.length+(kind==='quote'?2+2*(value.slice(start,entity.start).match(/\n/g)||[]).length:multiline?(before.length+after.length)*(value.slice(start,entity.start).match(/\n/g)||[]).length:0)};});
 return {text,entities:mapped,selection:[start+before.length,start+before.length+content.length]};
}

// A bounded lexical highlighter: text is never executed or inserted as HTML.
export function highlightCode(text,language=''){
 const lang=language.toLowerCase();if(!/^(js|javascript|jsx|ts|typescript|tsx|json|py|python|sql|sh|bash|shell|css|html|xml|java|kotlin|kt|c|cpp|go|rust|rb|ruby)$/.test(lang))return [{text,type:'text'}];
 const hash=/^(py|python|sh|bash|shell|rb|ruby)$/.test(lang),sql=lang==='sql';
 const token=/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
 const keywords=new Set('const let var function return if else for while class new import export from async await true false null undefined try catch throw def print in and or not None True False lambda with as select from where join insert into update delete create table values set order by limit public private fun val when object interface package void int boolean string extends implements static this yield switch case break continue do'.split(' '));
 let cursor=0,result=[];for(const m of text.matchAll(token)){if(m.index>cursor)result.push({text:text.slice(cursor,m.index),type:'text'});const v=m[0];let type='text';if(v.startsWith('//')||v.startsWith('/*')||hash&&v.startsWith('#')||sql&&v.startsWith('--'))type='comment';else if(/^["'`]/.test(v))type='string';else if(/^\d/.test(v))type='number';else if(keywords.has(sql?v.toLowerCase():v))type='keyword';result.push({text:v,type});cursor=m.index+v.length;}if(cursor<text.length)result.push({text:text.slice(cursor),type:'text'});return result;
}
