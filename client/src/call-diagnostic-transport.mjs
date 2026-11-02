/** A bounded, credential-free fallback carried by ordinary call API requests. */
export function callDiagnosticHeader(payload,now=Date.now()){
 if(!payload?.report_id||!Number.isFinite(payload.client_time)||now-payload.client_time>120000)return null;
 try{const bytes=new TextEncoder().encode(JSON.stringify(payload));if(bytes.length>3000)return null;const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');return encoded.length<=4096?encoded:null;}catch{return null;}
}
