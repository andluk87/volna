const key='volna.call.devices';
export function callDevices(){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return {microphone:typeof value.microphone==='string'?value.microphone:'',camera:typeof value.camera==='string'?value.camera:'',output:typeof value.output==='string'?value.output:'',incoming:value.incoming!==false};}catch{return {microphone:'',camera:'',output:'',incoming:true};}}
export function saveCallDevices(value){localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('volna-call-devices'));}
export function microphoneConstraints(){const selected=callDevices().microphone;return {echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(selected?{deviceId:{exact:selected}}:{})};}
export function cameraConstraints(facing){const selected=callDevices().camera;return {...(selected?{deviceId:{exact:selected}}:{facingMode:{ideal:facing?'user':'environment'}}),width:{ideal:640},height:{ideal:480}};}
