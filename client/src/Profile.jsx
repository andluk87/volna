import React,{useEffect,useRef,useState} from 'react';
import {request,uploadFile} from './api';
import Dialog from './Dialog';
import {Avatar} from './ui';
import './profile.css';

export default function Profile({id,me,token,revision,onClose,onSaved}){
 const own=id===me.id,[user,setUser]=useState(null),[name,setName]=useState(''),[bio,setBio]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const [username,setUsername]=useState(''),[usernameStatus,setUsernameStatus]=useState(null);
 const [phoneChange,setPhoneChange]=useState(false),[newPhone,setNewPhone]=useState(''),[smsCode,setSmsCode]=useState(''),[phoneChallenge,setPhoneChallenge]=useState('');
 const [contact,setContact]=useState(null),[alias,setAlias]=useState('');
 const dirty=useRef(false),usernameDirty=useRef(false),dialog=useRef(null);
 useEffect(()=>{const controller=new AbortController();request('/users/'+id,token,undefined,controller.signal).then(u=>{setUser(u);if(!usernameDirty.current)setUsername(u.username);if(!dirty.current){setName(u.name);setBio(u.bio);}}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[id,token,revision]);
 useEffect(()=>{const before=document.activeElement;dialog.current?.querySelector('button')?.focus();return()=>before?.focus();},[]);
 useEffect(()=>{if(!own||!username)return;const controller=new AbortController();setUsernameStatus(null);const timer=setTimeout(()=>request('/users/username/check?username='+encodeURIComponent(username),token,undefined,controller.signal).then(setUsernameStatus).catch(e=>{if(e.name!=='AbortError')setUsernameStatus({reason:e.message});}),300);return()=>{clearTimeout(timer);controller.abort();};},[own,username,token]);
 async function changeUsername(){setBusy(true);setError('');try{const result=await request('/users/me/username',token,{username},undefined,'PATCH');setUser(result.user);usernameDirty.current=false;setUsername(result.username);onSaved(result.user);}catch(e){setError(e.message);if(e.suggestions)setUsernameStatus({available:false,suggestions:e.suggestions});}finally{setBusy(false);}}
 async function save(e){e.preventDefault();setBusy(true);setError('');setSaved(false);try{const u=await request('/profile',token,{name,bio});setUser(u);setName(u.name);setBio(u.bio);dirty.current=false;setSaved(true);onSaved(u);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function photo(file,hide=false){
  if(busy||!user)return;setBusy(true);setError('');setSaved(false);let uploaded;
  try{
   if(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Фото профиля: PNG, JPEG или WebP, до 5 МБ');uploaded=await uploadFile(file,token);}
   const updated=await request('/profile',token,{name:user.name,bio:user.bio,avatar_id:uploaded?.id||null,avatar_hidden:hide});setUser(updated);onSaved(updated);
  }catch(e){if(uploaded)request('/uploads/'+uploaded.id+'/discard',token,{}).catch(()=>{});setError(e.message);}finally{setBusy(false);}
 }
 async function changePhone(){setBusy(true);setError('');try{if(!phoneChallenge){const result=await request('/auth/phone/change/request',token,{phone:newPhone});setPhoneChallenge(result.sms_session_id);}else{const result=await request('/auth/phone/change/verify',token,{sms_session_id:phoneChallenge,code:smsCode});setUser(result.user);onSaved(result.user);setPhoneChange(false);}}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function editContact(){try{const row=await request('/contacts/link',token,{user_id:id});setContact(row);setAlias(row.custom_name||'');}catch(e){setError(e.message);}}
 async function saveContact(){setBusy(true);try{await request(`/contacts/${contact.contact_id}/name`,token,{version:contact.version,custom_name:alias});setContact(null);setUser(await request('/users/'+id,token));window.dispatchEvent(new Event('volna-contacts-updated'));}catch(e){setError(e.message);}finally{setBusy(false);}}
 function key(e){if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],select:not(:disabled)')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
 return <div className="modal-backdrop"><section ref={dialog} className="modal user-profile" role="dialog" aria-modal="true" aria-labelledby="profile-title" onKeyDown={key}>
  <button className="icon-button profile-close" disabled={busy} aria-label="Закрыть профиль" onClick={onClose}>×</button>
  <h2 id="profile-title">{own?'Мой профиль':'Профиль'}</h2>{error&&<p className="error" role="alert">{error}</p>}
  {user?<>
   <Avatar name={user.name} id={user.id} src={user.avatar_url} token={token}/><h3>{user.name}</h3><p><a href={user.profile_url} target="_blank" rel="noreferrer">@{user.username}</a></p>
   {own&&<div className="profile-photo-actions"><label className="secondary">Выбрать фото<input type="file" aria-label="Фото профиля" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files[0];e.target.value='';if(file)photo(file);}}/></label>{user.avatar_url&&<button className="secondary" disabled={busy} onClick={()=>photo(null,true)}>Убрать фото</button>}</div>}
   {own&&<section className="username-editor"><label>Изменить username<input aria-label="Username" value={username} maxLength={33} disabled={busy} onChange={e=>{usernameDirty.current=true;setUsername(e.target.value);}}/></label><small>4–32 символа: латиница, цифры и _. Не используется для входа.</small>{/^\d+(?:_\d+)?$/.test(user.username)&&<p className="muted-note">Первоначальный ник содержит ваш номер телефона. Выберите собственный ник, чтобы убрать номер из публичной ссылки.</p>}<p role="status">{usernameStatus?.reason|| (usernameStatus?`@${usernameStatus.username||username} ${usernameStatus.available?'доступен':'уже занят'}`:'Проверяем…')}</p>{usernameStatus?.suggestions?.length>0&&<div className="username-suggestions">{usernameStatus.suggestions.map(n=><button key={n} className="secondary" onClick={()=>{usernameDirty.current=true;setUsername(n);}}>@{n}</button>)}</div>}<button className="secondary" disabled={busy||!usernameStatus?.available||usernameStatus.username===user.username} onClick={changeUsername}>Сохранить username</button><p><a href={user.profile_url} target="_blank" rel="noreferrer">{user.profile_url}</a></p></section>}
   {own?<form onSubmit={save}>
    <label>Имя<input aria-label="Имя профиля" value={name} required maxLength={64} disabled={busy} onChange={e=>{dirty.current=true;setName(e.target.value);setSaved(false);}}/></label>
    <label>О себе<textarea aria-label="О себе" value={bio} maxLength={280} rows={4} disabled={busy} onChange={e=>{dirty.current=true;setBio(e.target.value);setSaved(false);}}/></label>
    <small>{bio.length}/280 · Имя, фото и описание видны другим пользователям. Телефон доступен для точного поиска; публичный ник можно изменить.</small>
    <button className="primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить профиль'}</button>{saved&&<p role="status">Профиль сохранён</p>}
   </form>:<p className="profile-bio">{user.bio||'Пользователь пока не добавил описание.'}</p>}
   {!own&&<button className="secondary" onClick={editContact}>Изменить имя контакта</button>}
   {contact&&<Dialog title="Изменить имя" onClose={()=>setContact(null)}><p>Имя видите только вы на своих устройствах.</p><input aria-label="Личное имя" value={alias} maxLength={100} onChange={e=>setAlias(e.target.value)}/><button onClick={()=>setAlias('')}>Вернуть исходное имя</button><button className="primary" disabled={busy} onClick={saveContact}>Сохранить</button></Dialog>}
   {own&&<button className="secondary" onClick={()=>{setPhoneChange(true);setPhoneChallenge('');setNewPhone('');setSmsCode('');}}>Изменить номер телефона</button>}
   {phoneChange&&<Dialog title="Изменить номер телефона" onClose={()=>!busy&&setPhoneChange(false)}><p>История и контакты сохранятся в этом аккаунте. Аккаунты разных номеров не объединяются.</p>{error&&<p role="alert" className="error">{error}</p>}{!phoneChallenge?<input aria-label="Новый номер телефона" placeholder="+7 999 123-45-67" value={newPhone} onChange={e=>setNewPhone(e.target.value)}/>:<input aria-label="Код SMS нового номера" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={smsCode} onChange={e=>setSmsCode(e.target.value.replace(/\D/g,''))}/>}<button className="primary" disabled={busy} onClick={changePhone}>{phoneChallenge?'Подтвердить':'Отправить SMS'}</button></Dialog>}
   {own&&user.phone&&<p>Телефон: {user.phone} · подтверждён</p>}
  </>:!error&&<p>Загрузка…</p>}
 </section></div>;
}
