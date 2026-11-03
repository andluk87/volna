package dev.volna.messenger

internal fun nativeRelayGatherDecision(complete:Boolean,relays:Int,quietMs:Long,elapsedMs:Long):String? = when {
    complete -> "complete"
    relays>0&&quietMs>=200L -> "relay_ready"
    elapsedMs>=10000L -> "timeout"
    else -> null
}
