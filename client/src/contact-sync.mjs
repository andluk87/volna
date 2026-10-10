import {request} from './api.js';
const running=new Map();
export const contactBookKey=id=>'volna-contact-book:'+id;
export function cachedContactBook(id){try{return withPending(JSON.parse(localStorage.getItem(contactBookKey(id))||'{"contacts":[]}'),id);}catch{return {contacts:[]};}}
function withPending(book,id){let queue=[];try{queue=JSON.parse(localStorage.getItem(contactBookKey(id)+':pending')||'[]');}catch{}return {...book,contacts:(book.contacts||[]).map(row=>{const pending=queue.find(x=>x.contact_id===row.contact_id);return pending?{...row,custom_name:pending.custom_name,display_name:pending.custom_name||row.phonebook_name||row.user?.profile_name||row.user?.name}:row;})};}
export function refreshContactBook(token,id){const key=contactBookKey(id);if(running.has(key))return running.get(key);
 const promise=(async()=>{let book=await request('/contacts/book',token);localStorage.setItem(key,JSON.stringify(book));let queue=[];try{queue=JSON.parse(localStorage.getItem(key+':pending')||'[]');}catch{}
 while(queue.length){const item=queue[0];try{await request(`/contacts/${item.contact_id}/name`,token,item);}catch(error){error.contactBook=withPending(book,id);throw error;}queue.shift();localStorage.setItem(key+':pending',JSON.stringify(queue));}
 book=await request('/contacts/book',token);localStorage.setItem(key,JSON.stringify(book));return withPending(book,id);})().finally(()=>running.delete(key));running.set(key,promise);return promise;
}
export function contactNames(book){return new Map((book.contacts||[]).filter(c=>!c.deleted&&c.linked_user_id).map(c=>[c.linked_user_id,c.custom_name||c.phonebook_name||c.user?.profile_name||c.user?.name||c.user?.username]));}
