package dev.volna.messenger

import java.security.MessageDigest
import java.util.Base64

internal object NativeSmsCodeParser {
    // Exact own-app format and per-challenge nonce; never select an arbitrary
    // six-digit number from another service, an old attempt or an ID.
    fun parse(message: String, nonce: String, hash: String? = null): String? {
        if (message.toByteArray(Charsets.UTF_8).size > 140 || !nonce.matches(Regex("[A-Za-z0-9_-]{8}"))) return null
        val match = Regex("^<#> Код входа в Волна: ([0-9]{6})\\r?\\nПопытка: ([A-Za-z0-9_-]{8})(?:\\r?\\n([A-Za-z0-9+/]{11}))?$").matchEntire(message.trim()) ?: return null
        if (match.groupValues[2] != nonce) return null
        if (hash != null && match.groupValues[3] != hash) return null
        return match.groupValues[1]
    }
    fun appHash(packageName: String, certificateHex: String): String = Base64.getEncoder().withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest("$packageName $certificateHex".toByteArray(Charsets.UTF_8)).copyOfRange(0, 9)).take(11)
}
