package dev.volna.messenger

import android.app.Application
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Process
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.atomic.AtomicInteger

class VolnaApplication : Application(), coil.ImageLoaderFactory {
    override fun onCreate() { super.onCreate(); NativeCredentials.initialize(this); NativeCallDiagnostics.install(this) }
    override fun newImageLoader(): coil.ImageLoader = coil.ImageLoader.Builder(this).components {
        if (Build.VERSION.SDK_INT >= 28) add(coil.decode.ImageDecoderDecoder.Factory()) else add(coil.decode.GifDecoder.Factory())
        add(coil.decode.VideoFrameDecoder.Factory())
    }.diskCache { coil.disk.DiskCache.Builder().directory(cacheDir.resolve("image_cache")).maxSizeBytes(64L * 1024 * 1024).build() }.build()
}

/** Stages, exceptions and the crashed native thread; no memory dumps or log buffers. */
internal object NativeCallDiagnostics {
    private var prefs: SharedPreferences? = null
    @Volatile private var active = false
    @Volatile private var stage = ""
    @Volatile private var problem = ""
    private var startedAt = 0L
    private var runVersion = BuildConfig.VERSION_NAME
    private var runRtcVersion = BuildConfig.WEBRTC_VERSION
    private var runCodec = "программный VP8"
    private val revision = AtomicInteger()
    private val recovery = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val saved = MutableStateFlow("")
    val report: StateFlow<String> = saved
    @Synchronized fun install(context: Context) {
        if (prefs != null) return
        val storage = context.getSharedPreferences("volna-call-diagnostics", 0).also { prefs = it }
        stage = storage.getString("stage", "").orEmpty()
        problem = storage.getString("problem", "").orEmpty()
        runVersion = storage.getString("version", "версия не сохранена").orEmpty()
        runRtcVersion = storage.getString("webrtc", "версия не сохранена").orEmpty()
        runCodec = storage.getString("codec", "режим не сохранён").orEmpty()
        if (storage.getBoolean("active", false)) {
            saved.value = format("Процесс приложения был остановлен во время звонка.")
            storage.edit().putBoolean("active", false).putString("report", saved.value).commit()
            val oldPid = storage.getInt("pid", 0)
            val oldStart = storage.getLong("startedAt", 0L)
            val base = saved.value
            val expected = revision.get()
            recovery.launch {
                val details = exitDetails(context.applicationContext, oldPid, oldStart)
                if (details.isNotBlank()) synchronized(NativeCallDiagnostics) {
                    // A new call or a dismissed report must never be overwritten by recovery.
                    if (revision.get() == expected) {
                        saved.value = "$base\n\n$details"
                        storage.edit().putString("report", saved.value).commit()
                    }
                }
            }
        } else saved.value = storage.getString("report", "").orEmpty()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            if (active) {
                runCatching { problem = safe(error.stackTraceToString()).take(8000); storage.edit().putString("problem", problem).commit() }
            }
            // Persist evidence, then keep Android's normal crash handling.
            previous?.uncaughtException(thread, error)
        }
    }
    @Synchronized fun begin() {
        revision.incrementAndGet()
        startedAt = System.currentTimeMillis()
        runVersion = BuildConfig.VERSION_NAME
        runRtcVersion = BuildConfig.WEBRTC_VERSION
        runCodec = "программный VP8"
        active = true; problem = ""; saved.value = ""
        step("Подготовка звонка")
    }
    @Synchronized fun step(value: String) {
        if (!active) return
        stage = value
        Log.i("VolnaCall", value)
        prefs?.edit()?.putBoolean("active", active)?.putString("stage", stage)?.putString("problem", problem)
            ?.putInt("pid", Process.myPid())?.putLong("startedAt", startedAt)?.putString("version", runVersion)
            ?.putString("webrtc", runRtcVersion)?.putString("codec", runCodec)
            ?.putString("report", "")?.commit()
    }
    fun failure(error: Throwable) { problem = "Ошибка на этапе: $stage\n" + safe(error.stackTraceToString()).take(8000); Log.e("VolnaCall", "Ошибка на этапе: $stage", error) }
    @Synchronized fun finish(message: String) {
        if (!active) return
        active = false
        saved.value = if (message.isNotBlank()) format(message) else ""
        prefs?.edit()?.putBoolean("active", false)?.putString("problem", problem)?.putString("report", saved.value)?.commit()
    }
    @Synchronized fun clear() { revision.incrementAndGet(); saved.value = ""; prefs?.edit()?.remove("report")?.apply() }
    private fun format(message: String) = buildString {
        appendLine("Волна $runVersion")
        appendLine("WebRTC $runRtcVersion · видео: $runCodec")
        appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("ABI: ${Build.SUPPORTED_ABIS.joinToString()}")
        appendLine("Этап: $stage")
        appendLine(safe(message))
        append(problem)
    }.trim()

    private fun exitDetails(context: Context, pid: Int, start: Long): String {
        if (Build.VERSION.SDK_INT < 30 || pid <= 0 || start <= 0) return ""
        return runCatching {
            val manager = context.getSystemService(ActivityManager::class.java) ?: return@runCatching ""
            val exit = manager.getHistoricalProcessExitReasons(context.packageName, pid, 8).firstOrNull {
                it.pid == pid && it.timestamp >= start && it.processName == context.packageName
            } ?: return@runCatching "Android не сохранил причину завершения этого процесса."
            buildString {
                appendLine("Причина Android: ${reason(exit.reason)} (${exit.reason})")
                appendLine("Статус / сигнал: ${exit.status}")
                exit.description?.takeIf { it.isNotBlank() }?.let { appendLine("Описание: ${safe(it).take(1_500)}") }
                if (Build.VERSION.SDK_INT >= 31 && exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) {
                    val trace = runCatching { exit.traceInputStream?.use { NativeCrashTrace.read(it) } }
                    val text = trace.getOrNull()
                    if (text != null) append(safe(text))
                    else append("Нативный стек недоступен: ${trace.exceptionOrNull()?.message ?: "Android не сохранил tombstone"}.\nДля полного журнала: adb logcat -b crash -d")
                }
            }.trim()
        }.getOrElse { "Не удалось прочитать причину завершения Android: ${it.javaClass.simpleName}" }
    }
    private fun reason(code: Int): String = when (code) {
        ApplicationExitInfo.REASON_CRASH -> "Java-исключение"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "Сбой нативного кода"
        ApplicationExitInfo.REASON_ANR -> "Приложение не отвечало (ANR)"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "Недостаточно памяти"
        ApplicationExitInfo.REASON_SIGNALED -> "Остановка сигналом ОС"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "Принудительная остановка пользователем"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "Изменение разрешений"
        ApplicationExitInfo.REASON_EXIT_SELF -> "Процесс завершил работу сам"
        else -> "Другая причина"
    }
    private fun safe(value: String): String = value
        .replace(Regex("(?i)Bearer\\s+[A-Za-z0-9._~-]+"), "Bearer [скрыто]")
        .replace(Regex("(?i)(https?://)[^\\s/]+@"), "$1[скрыто]@")
        .replace(Regex("(?i)\\b(access_token|id_token|client_secret|authorization|password)\\s*[:=]\\s*[^\\s,;]+"), "$1=[скрыто]")
        .replace(Regex("(?m)^\\s*[vosiuepcbtmrak]=[^\\r\\n]*"), "[SDP скрыт]")
}
