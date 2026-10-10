// SMS Retriever accepts at most 140 UTF-8 bytes. Hashes identify APK signing
// certificates; they are not credentials and must be provisioned by the server.
export function androidSmsHashes(value=process.env.ANDROID_SMS_APP_HASHES||'') {
 return String(value).split(',').map(x=>x.trim()).filter(x=>/^[A-Za-z0-9+/]{11}$/.test(x));
}
export function smsMessage({code,id,android=false,appHash=''}) {
 if(!/^\d{6}$/.test(code))throw Error('Invalid OTP format');
 if(!android)return `${code} твоя волна`;
 if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw Error('Invalid challenge');
 if(appHash&&!/^[A-Za-z0-9+/]{11}$/.test(appHash))throw Error('Invalid application hash');
 const text=`${code} твоя волна Попытка: ${id.slice(0,8)}${appHash?' '+appHash:''}`;
 if(Buffer.byteLength(text,'utf8')>140)throw Error('OTP message exceeds SMS Retriever limit');
 return text;
}
export function maskedPhone(phone){return phone.slice(0,-7)+' *** ** '+phone.slice(-2);}
