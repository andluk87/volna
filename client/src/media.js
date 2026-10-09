export async function shareMedia(url,file){
 const [{Filesystem,Directory},{Share}]=await Promise.all([import('@capacitor/filesystem'),import('@capacitor/share')]);
 const blob=await(await fetch(url)).blob();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
 const saved=await Filesystem.writeFile({path:'volna/'+file.id+'/'+file.name.replace(/[\\/]/g,'_'),data,directory:Directory.Cache,recursive:true});await Share.share({title:file.name,files:[saved.uri],dialogTitle:'Сохранить или поделиться'});
}
