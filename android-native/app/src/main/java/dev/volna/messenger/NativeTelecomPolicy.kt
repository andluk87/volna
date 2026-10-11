package dev.volna.messenger

/** Reject delayed system commands for previous calls and duplicate answers. */
internal fun nativeTelecomActionAllowed(state: NativeCallState, id: String, incomingOnly: Boolean = false): Boolean {
    val call = state.call ?: return false
    return call.id == id && (!incomingOnly || call.incoming && call.status == "ringing" && !state.busy)
}

internal fun nativeTelecomUsesSystemFocus(api: Int, registered: Boolean, announced: String?, id: String) = api >= 28 && registered && announced == id
internal fun nativeTelecomShouldActivate(state: NativeCallState) = state.connected || state.call?.let { it.incoming && it.status != "ringing" } == true
