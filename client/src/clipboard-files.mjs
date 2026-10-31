/** Files carried by the paste event; never fetch HTML or clipboard URLs. */
export function clipboardFiles(data){
 const files=Array.from(data?.files||[]).filter(file=>file&&typeof file.name==='string');
 if(files.length)return files;
 return Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
}
