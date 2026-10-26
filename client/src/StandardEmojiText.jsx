import React from 'react';
const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'});
const components=new Set(['🏻','🏼','🏽','🏾','🏿','🦰','🦱','🦳','🦲','♀','♀️','♂','♂️','⚕','⚕️']);
function parts(text){
 const result=[];let plain='';
 for(const {segment} of segmenter.segment(text)){
  const className=/^[0-9#*]\ufe0f?\u20e3$/.test(segment)?'telegram-emoji-full':components.has(segment)?'telegram-text-component':'';
  if(className){if(plain){result.push({text:plain});plain='';}result.push({text:segment,className});}else plain+=segment;
 }
 if(plain)result.push({text:plain});return result;
}
export default function StandardEmojiText({text=''}){
 return parts(text).map((part,i)=>part.className?<span key={i} className={part.className}>{part.text}</span>:part.text);
}
export function appendStandardEmojiText(parent,text){
 for(const part of parts(text)){
  if(part.className){const span=document.createElement('span');span.className=part.className;span.textContent=part.text;parent.append(span);}
  else parent.append(document.createTextNode(part.text));
 }
}
