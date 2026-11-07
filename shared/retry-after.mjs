/** Prefer server-relative time so a phone's clock cannot turn a minute into hours. */
export function retryAfterMs({header,retry_at,server_time}={},now=Date.now()){
 let delay=null;
 if(Number.isFinite(retry_at)&&Number.isFinite(server_time)&&retry_at>0&&server_time>0)delay=retry_at-server_time;
 else if(header&&/^\d+(\.\d+)?$/.test(header))delay=Number(header)*1000;
 else if(header&&Number.isFinite(Date.parse(header)))delay=Date.parse(header)-now;
 return Math.max(1000,Math.min(300000,Number.isFinite(delay)?delay:60000));
}
