export const repeatKinds=['never','daily','weekly','fortnightly','monthly','quarterly','semiannual','yearly'];
export function validTimeZone(zone){try{if(typeof zone!=='string'||zone.length>80)return false;new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}
function parts(at,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return p;}
const utc=p=>Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0);
function instant(p,zone){const target=utc(p);let at=target;const tried=[];for(let i=0;i<5;i++){const delta=target-utc(parts(at,zone));if(!delta)return at;tried.push(at);at+=delta;if(tried.includes(at))return Math.max(at,...tried);}return at;}
export function repeatAt(kind,anchor,index,zone){
 const p=parts(anchor,zone),days={daily:1,weekly:7,fortnightly:14}[kind],months={monthly:1,quarterly:3,semiannual:6,yearly:12}[kind];
 if(!days&&!months)throw Error('Unknown repeat rule');
 if(days){const d=new Date(Date.UTC(p.year,p.month-1,p.day+days*index));p.year=d.getUTCFullYear();p.month=d.getUTCMonth()+1;p.day=d.getUTCDate();}
 else{const d=new Date(Date.UTC(p.year,p.month-1+months*index,1));p.year=d.getUTCFullYear();p.month=d.getUTCMonth()+1;p.day=Math.min(p.day,new Date(Date.UTC(p.year,p.month,0)).getUTCDate());}
 return instant(p,zone);
}
export function nextRepeat(rule,anchor,index,now){
 const days={daily:1,weekly:7,fortnightly:14}[rule.kind],months={monthly:1,quarterly:3,semiannual:6,yearly:12}[rule.kind];let next=index+1;
 if(days)next=Math.max(next,Math.floor((now-anchor)/(days*86400000))-1);
 else if(months){const a=parts(anchor,rule.time_zone),b=parts(now,rule.time_zone);next=Math.max(next,Math.floor(((b.year-a.year)*12+b.month-a.month)/months)-1);}
 let due=repeatAt(rule.kind,anchor,next,rule.time_zone);while(due<=now){next++;due=repeatAt(rule.kind,anchor,next,rule.time_zone);}return {due,index:next};
}
