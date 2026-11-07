package dev.volna.messenger

import android.content.SharedPreferences
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Persist intent only. Call and device IDs cannot be used as authentication. */
internal class NativeCallEndOutbox(private val prefs:SharedPreferences,scope:String,private val now:()->Long=System::currentTimeMillis){
 private val prefix="call_end_${scope}_"
 private val running=AtomicBoolean(false)
 private fun key(value:JSONObject)=prefix+value.getString("call_id")+"_"+value.getString("device")
 private fun write(value:JSONObject){prefs.edit().putString(key(value),value.toString()).commit()}
 private fun remove(value:JSONObject){prefs.edit().remove(key(value)).commit()}
 private fun entries():List<JSONObject>{
  val result=mutableListOf<JSONObject>()
  for((key,raw)in prefs.all){if(!key.startsWith(prefix)||raw !is String)continue
   val value=runCatching{JSONObject(raw)}.getOrNull()?:continue
   if(!value.optString("call_id").matches(Regex("[a-f0-9]{32}"))||!value.optString("device").matches(Regex("[a-f0-9]{32}")))continue
   if(now()-value.optLong("created")>86400000||value.optLong("created")>now()+60000)remove(value) else result+=value
  }
  return result.sortedBy{it.optLong("created")}
 }
 fun pending()=entries().isNotEmpty()
 fun has(id:String)=entries().any{it.optString("call_id")==id}
 fun add(id:String,device:String,reason:String){
  if(!id.matches(Regex("[a-f0-9]{32}"))||!device.matches(Regex("[a-f0-9]{32}"))||has(id))return
  write(JSONObject().put("call_id",id).put("device",device).put("end_reason",reason).put("created",now()).put("next",0).put("attempts",0))
  entries().dropLast(16).forEach(::remove)
 }
 /** Caller runs this on IO; an overlapping flush never waits for a socket. */
 fun flush(force:Boolean=false,send:(JSONObject)->Unit){
  if(!running.compareAndSet(false,true))return
  try{for(value in entries()){
   if(value.optLong("rate_until")>now()||!force&&value.optLong("next")>now())continue
   try{send(value);remove(value)}catch(problem:Exception){
    if(problem is NativeApiException&&problem.status in listOf(400,403,404,409,410)){remove(value);continue}
    val attempts=value.optInt("attempts")+1
    val wait=if(problem is NativeApiException&&problem.status==429)nativeCallRetryDelay(problem) else minOf(60000L,1000L*(1L shl minOf(attempts,6)))
    if(problem is NativeApiException&&problem.status==429)value.put("rate_until",now()+wait)
    write(value.put("attempts",attempts).put("next",now()+wait))
   }
  }}finally{running.set(false)}
 }
}
