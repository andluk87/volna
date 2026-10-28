import {boundaries} from './emoji-text.mjs';
export function replyQuote(value) {
 if(value==null)return null;
 if(typeof value!=='object'||typeof value.text!=='string'||!value.text.trim()||value.text.length>1024||!Number.isSafeInteger(value.offset)||value.offset<0)throw Object.assign(new Error('Выберите цитату до 1024 символов'),{status:400});
 return {text:value.text,offset:value.offset};
}
export function validQuote(source,quote){
 const edges=boundaries(source);
 return source.slice(quote.offset,quote.offset+quote.text.length)===quote.text&&edges.has(quote.offset)&&edges.has(quote.offset+quote.text.length);
}
