import alphabet from './call-safety-emoji.json' with {type:'json'};
export function callSafetyEmojis(code){
 const hex=String(code||'').replace(/[^a-fA-F0-9]/g,'');if(hex.length!==16)return '';
 const bytes=hex.match(/../g).map(x=>parseInt(x,16));return bytes.slice(0,4).map((x,i)=>alphabet[x^bytes[i+4]]).join(' ');
}
