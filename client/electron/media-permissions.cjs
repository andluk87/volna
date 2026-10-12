const fs=require('node:fs');
function mediaPermissions(file){
 let allowed={audio:false,video:false};try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));allowed={audio:saved.audio===true,video:saved.video===true};}catch{}
 return {has:type=>allowed[type]===true,grant(type){if(!['audio','video'].includes(type))return false;allowed[type]=true;try{fs.writeFileSync(file+'.tmp',JSON.stringify(allowed),{mode:0o600});fs.renameSync(file+'.tmp',file);return true;}catch{return false;}}};
}
module.exports={mediaPermissions};
