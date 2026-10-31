const path=require('node:path');
function trustedRenderer(url){try{const u=new URL(url);return u.protocol==='app:'&&u.host==='volna'&&!u.username&&!u.password;}catch{return false;}}
function externalURL(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function validateConfig(value){const u=new URL(value.apiBase);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Windows client requires a public HTTPS API URL');const apiBase=u.href.replace(/\/$/,'');return {apiBase,updateBase:apiBase+'/download/windows/'};}
function rendererFile(root,url){if(!trustedRenderer(url))return null;try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(url).pathname));return file.startsWith(root+path.sep)?file:null;}catch{return null;}}
function invitationCode(value,apiBase){
 if(typeof value!=='string'||value.length>2048||value.trim()!==value)return null;
 try{const u=new URL(value);if(u.username||u.password||u.hash)return null;
 if(u.protocol==='volna:')return u.host==='invite'&&!u.port&&!u.search&&/^\/[a-f0-9]{48}$/.test(u.pathname)?u.pathname.slice(1):null;
 const base=new URL(apiBase);if(u.protocol!=='https:'||u.origin!==base.origin||u.pathname!=='/app')return null;
 const codes=u.searchParams.getAll('invite');return codes.length===1&&/^[a-f0-9]{48}$/.test(codes[0])?codes[0]:null;
 }catch{return null;}
}
module.exports={invitationCode,trustedRenderer,externalURL,validateConfig,rendererFile};
