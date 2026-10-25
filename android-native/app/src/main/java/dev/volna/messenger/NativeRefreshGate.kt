package dev.volna.messenger

import java.io.IOException

/** Let refresh finish and persist before committing an APK that replaces this process. */
internal class NativeRefreshGate {
    private val lock = Any()
    @Volatile private var installing = false
    fun <T> refresh(action: () -> T): T = synchronized(lock) {
        if (installing) throw IOException("Устанавливается обновление VLN. Подключение восстановится после установки.")
        action()
    }
    fun <T> install(action: () -> T): T = synchronized(lock) {
        installing = true
        try { action() } catch (problem: Exception) { installing = false; throw problem }
    }
    fun resume() { installing = false }
}
