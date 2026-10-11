export async function preparePhoto(file,rotation=0){
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>50_000_000)throw Error('Фото слишком большое: максимум 50 мегапикселей');
  const factor=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*factor)),h=Math.max(1,Math.round(bitmap.height*factor));
  const canvas=document.createElement('canvas');canvas.width=rotation%180?h:w;canvas.height=rotation%180?w:h;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Не удалось обработать фото');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(bitmap,-w/2,-h/2,w,h);
  let blob;for(const quality of [.8,.68,.56]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!blob)throw Error('Не удалось сжать фото');if(blob.size<=500*1024)break;}
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
 }finally{bitmap.close();}
}
