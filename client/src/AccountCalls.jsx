import React,{useRef,useEffect} from 'react';
import Calls from './Calls';
export default function AccountCalls({accounts,selected,selectedRef,onError,onBeforeCall}){
 const engines=useRef(new Map());
 useEffect(()=>{selectedRef.current=engines.current.get(selected)||null;},[selected,accounts,selectedRef]);
 return accounts.filter(a=>a.token).map(account=><Calls key={account.user.id} ref={engine=>{if(engine)engines.current.set(account.user.id,engine);else engines.current.delete(account.user.id);if(account.user.id===selected)selectedRef.current=engine;}} token={account.token} accountId={account.user.id} accountName={account.user.name} onError={onError} onBeforeCall={()=>{for(const [id,engine] of engines.current)if(id!==account.user.id&&engine.isUsingAudio())throw Error('Сначала завершите текущий звонок на другом аккаунте');onBeforeCall?.();}}/>);
}
