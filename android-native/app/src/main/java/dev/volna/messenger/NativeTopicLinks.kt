package dev.volna.messenger

/** Topic links navigate within the configured server; they never grant membership. */
internal fun nativeLinkedTopicChat(value: String?, base: String): Long? = try {
    val uri=java.net.URI(value.orEmpty());val server=java.net.URI(base)
    if(uri.scheme!="https"||uri.host!=server.host||uri.port!=server.port||uri.userInfo!=null||uri.path!="/app")null
    else uri.rawQuery.orEmpty().split('&').filter{it.substringBefore('=')=="chat"}.singleOrNull()?.substringAfter('=')?.toLongOrNull()?.takeIf{it>0}
} catch(_:Exception){null}

/** Accept tokens from our own invitation URLs, never arbitrary account/login links. */
internal fun nativeCommunityInvite(value: String?, base: String): String? = try {
    val raw = value.orEmpty().trim()
    if (raw.matches(Regex("[a-f0-9]{48}"))) raw else {
        val uri = java.net.URI(raw); val server = java.net.URI(base)
        if (uri.scheme == "volna" && uri.host == "invite" && uri.port == -1 && uri.userInfo == null && uri.rawQuery == null && uri.fragment == null)
            uri.path.orEmpty().removePrefix("/").takeIf { it.matches(Regex("[a-f0-9]{48}")) }
        else if (uri.scheme != "https" || uri.host != server.host || uri.port != server.port || uri.userInfo != null || uri.path != "/app") null
        else uri.rawQuery.orEmpty().split('&').filter { it.substringBefore('=') in listOf("invite", "token") }.singleOrNull()
            ?.substringAfter('=')?.takeIf { it.matches(Regex("[a-f0-9]{48}")) }
    }
} catch (_: Exception) { null }
