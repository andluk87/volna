export async function photoCanvas(url,{maxEdge=2048,rotation=0,square=false}={}){
 const blob=await(await fetch(url)).blob(),bitmap=await createImageBitmap(blob);
 try{
  if(bitmap.width*bitmap.height>50_000_000)throw Error('Фото слишком большое: максимум 50 мегапикселей');
  const turn=((rotation%360)+360)%360,factor=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
  const w=Math.max(1,Math.round(bitmap.width*factor)),h=Math.max(1,Math.round(bitmap.height*factor));
  const canvas=document.createElement('canvas');canvas.width=square?maxEdge:turn%180?h:w;canvas.height=square?maxEdge:turn%180?w:h;
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось открыть редактор');
  context.translate(canvas.width/2,canvas.height/2);context.rotate(turn*Math.PI/180);context.drawImage(bitmap,-w/2,-h/2,w,h);
  return canvas;
 }finally{bitmap.close();}
}
export function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не удалось сохранить рисунок')),'image/png'));}
export async function photoFile(url,name,options={}){const canvas=await photoCanvas(url,options);return new File([await canvasBlob(canvas)],name.replace(/\.[^.]+$/,'')+'.png',{type:'image/png'});}
export function paintPhotoStrokes(context,strokes,width,height){
 for(const stroke of strokes){context.strokeStyle=stroke.color;context.fillStyle=stroke.color;context.lineWidth=stroke.width*width;context.lineCap='round';context.lineJoin='round';context.beginPath();
  stroke.points.forEach((point,i)=>{const x=point.x*width,y=point.y*height;if(i===0)context.moveTo(x,y);else context.lineTo(x,y);});
  if(stroke.points.length===1){const p=stroke.points[0];context.arc(p.x*width,p.y*height,context.lineWidth/2,0,Math.PI*2);context.fill();}else context.stroke();
 }
}
