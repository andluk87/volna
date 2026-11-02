package dev.volna.messenger

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.BufferOverflow
import org.json.JSONObject
import android.util.Base64
import android.util.Log
import java.util.UUID

/** Best-effort bounded telemetry. Never blocks the media thread or contains SDP/credentials. */
internal object NativeCallTelemetry {
    private data class Item(val session:String,val body:JSONObject)
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val queue=Channel<Item>(64,BufferOverflow.DROP_OLDEST)
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL,requestTimeoutSeconds=5) }
    @Volatile private var latest:Item? = null
    private var warningAt=0L
    private val processId=UUID.randomUUID().toString().replace("-", "")
    private var sequence=0L
    init { scope.launch { for(item in queue)try { api.callDiagnostic(item.session,item.body) } catch(problem:Exception) {
        synchronized(this@NativeCallTelemetry) { if(latest===item){val copy=JSONObject(item.body.toString()).put("report_id",UUID.randomUUID().toString().replace("-", "")).put("delivery_error_type",problem.javaClass.simpleName);if(problem is NativeApiException)copy.put("delivery_http_status",problem.status);latest=Item(item.session,copy)} }
        val now=android.os.SystemClock.elapsedRealtime();if(now-warningAt>10000){warningAt=now;Log.w("VolnaCallTelemetry","delivery_failed status=${(problem as? NativeApiException)?.status?:0} type=${problem.javaClass.simpleName}")}
    } } }
    fun header(session:String):String? {
        val item=latest?:return null
        return nativeCallDiagnosticHeader(session,item.session,item.body,System.currentTimeMillis())
    }
    @Synchronized fun send(session:String,device:String,call:String?,event:String,fields:JSONObject=JSONObject()) {
        if(session.isBlank()||device.length!=32)return
        val body=JSONObject(fields.toString()).put("sequence",++sequence).put("process_id",processId).put("uptime_ms",android.os.SystemClock.elapsedRealtime()).put("sdk",android.os.Build.VERSION.SDK_INT).put("model",android.os.Build.MODEL.take(64)).put("manufacturer",android.os.Build.MANUFACTURER.take(64)).put("report_id",UUID.randomUUID().toString().replace("-", "")).put("event",event).put("platform","android").put("device",device).put("client_version",BuildConfig.VERSION_NAME).put("client_time",System.currentTimeMillis())
        if(!call.isNullOrBlank())body.put("call_id",call)
        // Mirror controlled fields to logcat so termination is visible even during a server outage.
        if(call!=null || event=="client.error")Log.i("VolnaCallDebug",body.toString())
        val item=Item(session,body);latest=item;queue.trySend(item)
    }
}
internal data class NativeCallStat(val id:String,val type:String,val members:Map<String,Any>)
internal fun nativeCallStats(rows:List<NativeCallStat>):JSONObject {
    val out=JSONObject();val totals=mutableMapOf("bytes_sent" to 0L,"bytes_received" to 0L,"packets_sent" to 0L,"packets_received" to 0L,"packets_lost" to 0L)
    for(row in rows){val keys=when(row.type){"outbound-rtp"->listOf("bytesSent" to "bytes_sent","packetsSent" to "packets_sent");"inbound-rtp"->listOf("bytesReceived" to "bytes_received","packetsReceived" to "packets_received","packetsLost" to "packets_lost");else->emptyList()};for((source,target)in keys)totals[target]=totals.getValue(target)+((row.members[source] as? Number)?.toLong()?:0)}
    for((key,value)in totals)out.put(key,value)
    val selected=rows.firstOrNull{it.type=="transport"&&it.members["selectedCandidatePairId"]!=null}?.members?.get("selectedCandidatePairId")
    val pair=rows.firstOrNull{it.id==selected}?:rows.firstOrNull{it.type=="candidate-pair"&&it.members["state"]=="succeeded"&&it.members["nominated"]==true}
    pair?.let { val local=rows.firstOrNull{r->r.id==it.members["localCandidateId"]};local?.members?.get("candidateType")?.let{value->if(value in listOf("relay","host","srflx","prflx"))out.put("candidate_type",value)};local?.members?.get("protocol")?.let{value->if(value in listOf("udp","tcp"))out.put("protocol",value)};(it.members["currentRoundTripTime"] as? Number)?.let{rtt->out.put("rtt_ms",(rtt.toDouble()*1000).toLong())} }
    return out
}
internal fun nativeCandidateSummary(sdp:String):JSONObject {
    val counts=mutableMapOf("relay_count" to 0,"host_count" to 0,"srflx_count" to 0,"prflx_count" to 0,"udp_count" to 0,"tcp_count" to 0)
    for(line in sdp.lineSequence().filter{it.startsWith("a=candidate:")}){val p=line.trim().split(Regex("\\s+"));val type=p.getOrNull(p.indexOf("typ")+1);if(counts.containsKey(type+"_count"))counts[type+"_count"]=counts.getValue(type+"_count")+1;val protocol=p.getOrNull(2)?.lowercase();if(protocol in listOf("udp","tcp"))counts[protocol+"_count"]=counts.getValue(protocol+"_count")+1}
    return JSONObject(counts as Map<*,*>)
}

internal fun nativeCallDiagnosticHeader(session:String,owner:String,body:JSONObject,now:Long):String? {
    if(session!=owner||now-body.optLong("client_time")>120000)return null
    val value=Base64.encodeToString(body.toString().toByteArray(Charsets.UTF_8),Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
    return value.takeIf { it.length<=4096 }
}
