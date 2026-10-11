package dev.volna.messenger

/** Opus is interoperable with WebRTC browsers; G.729 is not a WebRTC audio codec. */
internal fun economicalAudioSdp(sdp: String): String {
    val separator = if (sdp.contains("\r\n")) "\r\n" else "\n"
    return sdp.split(Regex("(?=^m=)", RegexOption.MULTILINE)).joinToString("") { section ->
        if (!section.startsWith("m=audio ")) section else {
            val lines = section.trimEnd().split(Regex("\\r?\\n")).toMutableList()
            val payloads = lines.mapNotNull { Regex("^a=rtpmap:(\\d+) opus/48000(?:/2)?$", RegexOption.IGNORE_CASE).matchEntire(it)?.groupValues?.get(1) }
            if (payloads.isEmpty()) section else {
                payloads.forEach { payload ->
                    val prefix = "a=fmtp:$payload "
                    val index = lines.indexOfFirst { it.startsWith(prefix) }
                    val parameters = linkedMapOf<String, String>()
                    if (index >= 0) lines[index].removePrefix(prefix).split(';').filter { it.isNotBlank() }.forEach { value ->
                        val pair = value.trim().split('=', limit = 2); parameters[pair[0]] = pair.getOrElse(1) { "" }
                    }
                    parameters.putAll(mapOf("maxaveragebitrate" to "24000", "stereo" to "0", "sprop-stereo" to "0", "usedtx" to "1", "useinbandfec" to "1"))
                    val line = prefix + parameters.entries.joinToString(";") { "${it.key}=${it.value}" }
                    if (index < 0) lines.add(line) else lines[index] = line
                }
                lines.removeAll { it.startsWith("a=ptime:") || it.startsWith("a=maxptime:") }
                lines.add("a=ptime:40"); lines.add("a=maxptime:60")
                lines.joinToString(separator) + separator
            }
        }
    }
}
