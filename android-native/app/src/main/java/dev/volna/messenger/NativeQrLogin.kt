package dev.volna.messenger

import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/** Only camera scans call this flow; opening a deep link still requires approval. */
internal suspend fun nativeAuthorizeScannedQr(qr: String, scan: suspend (String) -> Unit, approve: suspend (String) -> Unit) {
    require(qr.matches(Regex("volna://login/[A-Za-z0-9_-]{43}"))) { "Это не QR-код входа VLN" }
    scan(qr)
    coroutineContext.ensureActive()
    approve(qr)
}
