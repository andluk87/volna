package dev.volna.messenger

import kotlinx.coroutines.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** Activity visibility only. The notification service never announces foreground presence. */
internal object NativeForegroundPresence {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = UUID.randomUUID().toString().replace("-", "")
    private val sequence = AtomicLong()
    private var token = ""
    private var visible = false
    private var heartbeat: Job? = null
    private fun report(session: String, value: Boolean) {
        if (session.isBlank()) return
        val version = sequence.incrementAndGet()
        scope.launch { runCatching { NativeApi(BuildConfig.API_BASE_URL).presence(session, client, value, version) } }
    }
    @Synchronized fun session(value: String) {
        if (value == token) return
        report(token, false); token = value; restart()
    }
    @Synchronized fun visible(value: Boolean) {
        if (value == visible) return
        visible = value; restart()
    }
    private fun restart() {
        heartbeat?.cancel(); heartbeat = null
        report(token, visible)
        if (visible && token.isNotBlank()) {
            val session = token
            heartbeat = scope.launch { while (isActive) { delay(10_000); synchronized(this@NativeForegroundPresence) { if (isActive && visible && token == session) report(session, true) } } }
        }
    }
}
