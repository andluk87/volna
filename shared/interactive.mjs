export function interactivePayload(data){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(data.poll!=null&&data.checklist!=null)fail('Выберите опрос или список');
 if(data.poll!=null){
  const p=data.poll;
  if(!p||typeof p.question!=='string'||!p.question.trim()||p.question.trim().length>255||!Array.isArray(p.options)||p.options.length<2||p.options.length>10)fail('Проверьте опрос: вопрос и от 2 до 10 вариантов');
  const options=p.options.map(o=>{if(!o||typeof o.text!=='string'||!o.text.trim()||o.text.trim().length>100)fail('Проверьте вариант ответа: от 1 до 100 символов');return {text:o.text.trim(),voters:[]};});
  if(new Set(options.map(o=>o.text.toLocaleLowerCase('ru-RU'))).size!==options.length)fail('Проверьте варианты: ответы должны отличаться');
  return {poll:{question:p.question.trim(),options}};
 }
 if(data.checklist!=null){
  const c=data.checklist;
  if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.trim().length>255||!Array.isArray(c.items)||c.items.length<1||c.items.length>30)fail('Список: название и от 1 до 30 пунктов');
  return {checklist:{title:c.title.trim(),items:c.items.map(i=>{if(!i||typeof i.text!=='string'||!i.text.trim()||i.text.trim().length>200)fail('Пункт списка: от 1 до 200 символов');return {text:i.text.trim(),done:false};})}};
 }
 return null;
}
