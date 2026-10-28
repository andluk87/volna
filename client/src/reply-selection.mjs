import {validQuote} from '../../shared/reply-quote.mjs';
export function quoteFromSelection(root,source,selection){
 if(!root||!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
 const range=selection.getRangeAt(0);
 if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
 const text=selection.toString();if(!text.trim()||text.length>1024)return null;
 const prefix=range.cloneRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
 const estimate=prefix.toString().length,candidates=[];
 for(let offset=source.indexOf(text);offset>=0;offset=source.indexOf(text,offset+1))if(validQuote(source,{text,offset}))candidates.push(offset);
 candidates.sort((a,b)=>Math.abs(a-estimate)-Math.abs(b-estimate));
 return candidates.length?{text,offset:candidates[0]}:null;
}
