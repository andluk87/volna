import {useState,useEffect,useRef,useCallback} from 'react';
import {readDrafts,writeDrafts,clearDrafts} from './drafts.mjs';
const storage={getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)};
const demoStorage={getItem:key=>storage.getItem('demo.'+key),setItem:(key,value)=>storage.setItem('demo.'+key,value),removeItem:key=>storage.removeItem('demo.'+key)};
const storeFor=id=>id===-1?demoStorage:storage;
const storageId=id=>id===-1?1:id;
export default function useDrafts(userId){
 const [state,setState]=useState({owner:null,items:{}}),[failed,setFailed]=useState(false);
 const owner=useRef(null);
 useEffect(()=>{if(userId>0){try{const key='volna.drafts.v1.'+userId,old=localStorage.getItem(key);if(old&&!sessionStorage.getItem(key))sessionStorage.setItem(key,old);localStorage.removeItem(key);}catch{}}owner.current=userId||null;setState({owner:userId||null,items:readDrafts(storeFor(userId),storageId(userId))});setFailed(false);},[userId]);
 useEffect(()=>{if(userId&&state.owner===userId)setFailed(!writeDrafts(storeFor(userId),storageId(userId),state.items));},[state,userId]);
 const setDrafts=useCallback(update=>setState(previous=>{
  const id=owner.current,items=previous.owner===id?previous.items:{};
  return {owner:id,items:typeof update==='function'?update(items):update};
 }),[]);
 const clear=useCallback(()=>{clearDrafts(storeFor(owner.current),storageId(owner.current));owner.current=null;setState({owner:null,items:{}});setFailed(false);},[]);
 return [state.owner===userId?state.items:{},setDrafts,clear,failed];
}
