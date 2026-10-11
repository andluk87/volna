const fs=require('node:fs');
// Electron's dictionary is persistent. Journal temporary additions so a crash
// cannot turn “ignore” into a permanent dictionary change.
function ignoredSpelling(session,file){
 let words=new Set();
 try{for(const word of JSON.parse(fs.readFileSync(file,'utf8')))if(typeof word==='string')session.removeWordFromSpellCheckerDictionary(word);}catch{}
 const save=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify([...words]),{mode:0o600});fs.renameSync(temp,file);};
 save();
 return {
  ignore(word){if(typeof word!=='string'||!word||word.length>200)return false;words.add(word);save();if(session.addWordToSpellCheckerDictionary(word)!==true){words.delete(word);save();return false;}return true;},
  add(word){const result=session.addWordToSpellCheckerDictionary(word);if(result){words.delete(word);save();}return result;},
  clear(){for(const word of words)session.removeWordFromSpellCheckerDictionary(word);words.clear();save();}
 };
}
module.exports={ignoredSpelling};
