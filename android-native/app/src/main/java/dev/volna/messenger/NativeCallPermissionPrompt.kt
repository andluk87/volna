package dev.volna.messenger
/** Check each update, and a revoked permission on resume; do not repeat a dismissed prompt. */
internal fun nativeCallPermissionPrompt(ready:Boolean,wasReady:Boolean,checkedVersion:Int,version:Int,prompted:Boolean):Boolean =
    !ready && (!prompted || checkedVersion != version || wasReady)
