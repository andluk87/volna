export function albumRows(count){
 return ({2:[2],3:[1,2],4:[1,3],5:[2,3],6:[3,3],7:[3,2,2],8:[3,3,2],9:[3,3,3],10:[3,3,2,2]})[count]||[count];
}
export function albumCellStyle(count,index){
 const rows=albumRows(count);let start=0;
 for(const columns of rows){
  if(index<start+columns){const height=rows.length===1?.62:columns===1?.72:count<=4?.42:rows.length===2?.4:.32;return {gridColumn:`span ${12/columns}`,aspectRatio:String((1/columns)/height)};}
  start+=columns;
 }
 return {};
}
