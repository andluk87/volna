import {readAdminSettings} from './admin-config.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function notificoreSender({key=process.env.NOTIFICORE_API_KEY||'',originator=process.env.NOTIFICORE_ORIGINATOR||'',fetcher=fetch}={}){
  return async ({phone,code,reference})=>{
    if(!key||!originator)throw fail(503,'Отправка SMS пока не настроена');
    const response=await fetcher('https://api.notificore.ru/v1.0/sms/create',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'X-API-KEY':key,'Content-Type':'application/json'},
      body:JSON.stringify({destination:'phone',originator,body:`${code.slice(0,3)}-${code.slice(3)} твоя волна`,msisdn:phone.slice(1),reference})});
    const text=await response.text();if(text.length>32000)throw fail(503,'SMS-провайдер временно недоступен');
    let data;try{data=JSON.parse(text);}catch{throw fail(503,'SMS-провайдер временно недоступен');}
    const result=data.result||data;
    if(!response.ok||Number(result.error)!==0||!result.id)throw Object.assign(fail(503,'Не удалось отправить SMS. Повторите позже'),{smsDiagnostic:{kind:'provider-rejected',http_status:response.status,provider_error:Number.isSafeInteger(Number(result.error))?Number(result.error):null}});
    // Do not retain the provider's raw response: it may echo phone, body or secrets.
    return {id:String(result.id).slice(0,100),error:0};
  };
}
export function gatewayPhone(phone){if(typeof phone!=='string'||!/^\+7\d{10}$/.test(phone))throw fail(400,'SMS-шлюз поддерживает номера +7 и отправляет их в формате 89997776655');return '8'+phone.slice(2);}
export function gatewaySender({url=process.env.SMS_GATEWAY_URL||'http://188.128.67.14:3825/default/en_US/send.html',user=process.env.SMS_GATEWAY_USER||'',password=process.env.SMS_GATEWAY_PASSWORD||'',line=process.env.SMS_GATEWAY_LINE||'4',fetcher=fetch}={}){
 return async({phone,code})=>{
  if(!user.trim()||!password||!/^\d{1,3}$/.test(String(line)))throw fail(503,'SMS-шлюз не настроен');
  let endpoint;try{endpoint=new URL(url);if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();}catch{throw fail(503,'Некорректный адрес SMS-шлюза');}
  if(!/^\d{6}$/.test(code))throw fail(400,'Некорректный код SMS');
  const destination=gatewayPhone(phone);
  endpoint.search=new URLSearchParams({u:user,p:password,l:String(line),n:destination,m:`${code.slice(0,3)}-${code.slice(3)} твоя волна`}).toString().replace(/\+/g,'%20');
  // No redirects or automatic retries: the GET request sends a real SMS and includes credentials.
  const response=await fetcher(endpoint.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/plain, text/html, application/json','Cache-Control':'no-store',Pragma:'no-cache'}});
  const raw=await response.text();if(raw.length>32000)throw fail(503,'SMS-шлюз вернул некорректный ответ');
  const plain=raw.replace(/<[^>]*>/g,' ').trim();
  const receipt=plain.match(/^Sending,L(\d{1,3})\s+Send\s+SMS\s+to:\s*(\d{11})\s*;\s*ID:\s*(\d{1,32})(?:\s|$)/i);
  if(!response.ok||!receipt||Number(receipt[1])!==Number(line)||receipt[2]!==destination||/\b(?:error|failed|failure|denied|invalid|unauthorized)\b/i.test(plain))throw Object.assign(fail(503,'SMS-шлюз не подтвердил принятие сообщения'),{smsDiagnostic:{kind:'gateway-rejected',http_status:response.status}});
  // Keep only the gateway ID, never the raw reply containing the destination.
  return {id:receipt[3],provider:'gateway',error:0};
 };
}
export function createSmsRouter({db,fetcher=fetch,notificoreKey=process.env.NOTIFICORE_API_KEY||'',notificoreOriginator=process.env.NOTIFICORE_ORIGINATOR||'',gatewayUrl=process.env.SMS_GATEWAY_URL||'http://188.128.67.14:3825/default/en_US/send.html',gatewayUser=process.env.SMS_GATEWAY_USER||'',gatewayPassword=process.env.SMS_GATEWAY_PASSWORD||'',gatewayLine=process.env.SMS_GATEWAY_LINE||'4'}={}){
 const selected=()=>readAdminSettings(db).sms_provider;
 const providers={notificore:{label:'Notificore',configured:!!(notificoreKey.trim()&&notificoreOriginator.trim())},gateway:{label:'SMS-шлюз · линия '+String(gatewayLine).replace(/\D/g,'').slice(0,3),configured:false}};
 try{const u=new URL(gatewayUrl);providers.gateway.configured=!!(gatewayUser.trim()&&gatewayPassword&&/^\d{1,3}$/.test(String(gatewayLine))&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash);}catch{}
 const senders={notificore:notificoreSender({key:notificoreKey,originator:notificoreOriginator,fetcher}),gateway:gatewaySender({url:gatewayUrl,user:gatewayUser,password:gatewayPassword,line:gatewayLine,fetcher})};
 return {selected,validatePhone:(phone,provider=selected())=>provider==='gateway'?gatewayPhone(phone):phone,ready:()=>!!providers[selected()]?.configured,status:()=>({selected:selected(),providers}),send:async challenge=>{const provider=challenge.provider||selected();if(!providers[provider]?.configured)throw fail(503,'Выбранный SMS-провайдер не настроен');return senders[provider](challenge);}};
}
