package dev.volna.messenger

internal enum class NativeCallConfiguration { KEEP, BLOCK, RESET }

internal fun nativeSameCallSession(current:String,requested:String,resolve:(String)->String):Boolean {
    if(current.isBlank()||requested.isBlank())return false
    val resolved=resolve(current)
    return resolved.isNotBlank()&&resolved==resolve(requested)
}

/** Refresh aliases refer to one account. Opening its call screen must not release its media. */
internal fun nativeCallConfiguration(initialized:Boolean,current:String,requested:String,active:Boolean,resolve:(String)->String):NativeCallConfiguration {
    val same=nativeSameCallSession(current,requested,resolve)
    if(initialized&&(current==requested||same))return NativeCallConfiguration.KEEP
    if(requested.isNotBlank()&&active&&!same)return NativeCallConfiguration.BLOCK
    return NativeCallConfiguration.RESET
}
