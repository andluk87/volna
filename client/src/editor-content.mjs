/** Read Chromium's contenteditable blocks as lines, with atomic custom-emoji offsets. */
export function editorContent(root){
 let text='',entities=[];
 const block=node=>node.nodeType===1&&['DIV','P','LI'].includes(node.tagName);
 function children(parent){let previous=null;for(const node of parent.childNodes){if(previous&&(block(previous)||block(node))){if(block(previous)||!text.endsWith('\n'))text+='\n';}visit(node);previous=node;}}
 function visit(node){
  if(node.nodeType===3){text+=node.data;return;}
  if(node.nodeType!==1&&node.nodeType!==11)return;
  if(node.dataset?.emojiId){const fallback=node.dataset.fallback||'';entities.push({id:node.dataset.emojiId,start:text.length,length:fallback.length,attachment_id:node.dataset.file||undefined,mime:'image/png'});text+=fallback;return;}
  if(node.tagName==='BR'){
   // An empty editable block has a caret placeholder, not an extra text line.
   if(!node.dataset.editorTail&&!(node.parentNode?.childNodes.length===1&&block(node.parentNode)))text+='\n';return;
  }
  children(node);
 }
 children(root);return {text,entities};
}
