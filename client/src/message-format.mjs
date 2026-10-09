const inlinePattern=/(__[^_\n]+__|\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^)\s]+\))/g;

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

export function parseInline(text=''){
 const output=[];let last=0,match;inlinePattern.lastIndex=0;
 while((match=inlinePattern.exec(text))){if(match.index>last)output.push({type:'text',text:text.slice(last,match.index)});const raw=match[0];
  if(raw.startsWith('__'))output.push({type:'underline',text:raw.slice(2,-2)});
  else if(raw.startsWith('**'))output.push({type:'strong',text:raw.slice(2,-2)});
  else if(raw.startsWith('~~'))output.push({type:'del',text:raw.slice(2,-2)});
  else if(raw.startsWith('*')||raw.startsWith('_'))output.push({type:'em',text:raw.slice(1,-1)});
  else if(raw.startsWith('`'))output.push({type:'inline-code',text:raw.slice(1,-1)});
  else{const link=raw.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/);output.push({type:'link',text:link[1],href:link[2]});}
  last=inlinePattern.lastIndex;
 }
 if(last<text.length)output.push({type:'text',text:text.slice(last)});return output;
}
