const path=require('node:path');
function trustedRenderer(url){try{const u=new URL(url);return u.protocol==='app:'&&u.host==='volna'&&!u.username&&!u.password;}catch{return false;}}
function externalURL(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function validateConfig(value){const u=new URL(value.apiBase);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Windows client requires a public HTTPS API URL');const apiBase=u.href.replace(/\/$/,'');return {apiBase,updateBase:apiBase+'/download/windows/'};}
function rendererFile(root,url){if(!trustedRenderer(url))return null;try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(url).pathname));return file.startsWith(root+path.sep)?file:null;}catch{return null;}}
module.exports={trustedRenderer,externalURL,validateConfig,rendererFile};
