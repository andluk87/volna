package dev.volna.messenger

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.BufferOverflow
import org.json.JSONObject

/** Best-effort bounded telemetry. Never blocks the media thread or contains SDP/credentials. */
internal object NativeCallTelemetry {
    private data class Item(val session:String,val body:JSONObject)
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val queue=Channel<Item>(64,BufferOverflow.DROP_OLDEST)
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL,requestTimeoutSeconds=5) }
    init { scope.launch { for(item in queue)runCatching { api.callDiagnostic(item.session,item.body) } } }
    fun send(session:String,device:String,call:String?,event:String,fields:JSONObject=JSONObject()) {
        if(session.isBlank()||device.length!=32)return
        val body=JSONObject(fields.toString()).put("event",event).put("platform","android").put("device",device).put("client_version",BuildConfig.VERSION_NAME).put("client_time",System.currentTimeMillis())
        if(!call.isNullOrBlank())body.put("call_id",call)
        queue.trySend(Item(session,body))
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
