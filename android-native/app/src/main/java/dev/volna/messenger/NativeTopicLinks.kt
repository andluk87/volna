package dev.volna.messenger

/** Topic links navigate within the configured server; they never grant membership. */
internal fun nativeLinkedTopicChat(value: String?, base: String): Long? = try {
    val uri=java.net.URI(value.orEmpty());val server=java.net.URI(base)
    if(uri.scheme!="https"||uri.host!=server.host||uri.port!=server.port||uri.userInfo!=null||uri.path!="/app")null
    else uri.rawQuery.orEmpty().split('&').filter{it.substringBefore('=')=="chat"}.singleOrNull()?.substringAfter('=')?.toLongOrNull()?.takeIf{it>0}
} catch(_:Exception){null}
