package dev.volna.messenger

import java.net.URI

internal data class NativeImageSource(val url: String, val authenticated: Boolean)

/** Resolve server-relative artwork and authenticate only files on our API origin. */
internal fun nativeImageSource(baseUrl: String, path: String): NativeImageSource {
    val base = URI(baseUrl.trimEnd('/') + "/")
    val resolved = runCatching { base.resolve(URI(path)) }.getOrNull()
        ?: return NativeImageSource(path, false)
    fun port(uri: URI) = if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80
    val ownOrigin = resolved.scheme == base.scheme && resolved.host == base.host && port(resolved) == port(base) && resolved.userInfo == null
    val file = resolved.path.orEmpty().matches(Regex("/api/files/[a-f0-9]{48}"))
    return NativeImageSource(resolved.toString(), ownOrigin && file)
}
