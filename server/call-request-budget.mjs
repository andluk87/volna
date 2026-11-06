// Polling and telemetry run independently on every signed-in device. They must
// not consume the account's messaging budget or block another device's calls.
export function callRequestBudget(path,method){
 if(method==='GET'&&path==='/api/calls/current')return {bucket:'poll',max:180};
 if(method==='GET'&&path==='/api/calls/config')return {bucket:'config',max:30};
 if(method==='POST'&&path==='/api/calls/diagnostics')return {bucket:'diagnostics',max:180};
 if(method==='POST'&&(path==='/api/calls/start'||/^\/api\/calls\/[a-f0-9]{32}\/(offer|accept|answer|ringing|ice-restart|media-state|screen|camera|end)$/.test(path)))return {bucket:'signaling',max:120};
 return null;
}
