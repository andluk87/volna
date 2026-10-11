package dev.volna.messenger

/** Reject delayed system commands for previous calls and duplicate answers. */
internal fun nativeTelecomActionAllowed(state: NativeCallState, id: String, incomingOnly: Boolean = false): Boolean {
    val call = state.call ?: return false
    return call.id == id && (!incomingOnly || call.incoming && call.status == "ringing" && !state.busy)
}
