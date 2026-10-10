package dev.volna.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.media.AudioDeviceCallback
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

class CallService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var proximityLock: PowerManager.WakeLock? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val devices = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) { updateProximity(NativeCalls.state.value) }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) { updateProximity(NativeCalls.state.value) }
    }
    private var communicationChanged: AudioManager.OnCommunicationDeviceChangedListener? = null
    private var projecting = false
    private var cameraActive = false

    override fun onCreate() {
        super.onCreate()
        val audio = getSystemService(AudioManager::class.java)
        audio.registerAudioDeviceCallback(devices, Handler(Looper.getMainLooper()))
        if (Build.VERSION.SDK_INT >= 31) {
            communicationChanged = AudioManager.OnCommunicationDeviceChangedListener { updateProximity(NativeCalls.state.value) }
            audio.addOnCommunicationDeviceChangedListener(mainExecutor, communicationChanged!!)
        }
        serviceScope.launch { NativeCalls.state.collect { updateProximity(it) } }
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Активный звонок", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (NativeCalls.state.value.call == null) { ready?.completeExceptionally(IllegalStateException("Звонок завершён")); stopSelf(); return START_NOT_STICKY }
        try {
            projecting = intent?.action == ACTION_SCREEN || projecting
            updateForeground()
            instance = this
            if (wakeLock == null) {
                wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Volna:Call").apply {
                    setReferenceCounted(false); acquire(4 * 60 * 60 * 1000L)
                }
            }
            ready?.complete(this)
            if (intent?.action == ACTION_SCREEN) {
                val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("screen_data", Intent::class.java) else intent.getParcelableExtra<Intent>("screen_data")
                if (data != null) NativeCalls.captureScreen(data) else projectionStopped()
            }
        } catch (problem: Exception) {
            ready?.completeExceptionally(problem)
            NativeCalls.end(problem.message ?: "Не удалось запустить фоновый звонок")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun updateProximity(state: NativeCallState) {
        val audio = getSystemService(AudioManager::class.java)
        val earpiece = if (Build.VERSION.SDK_INT >= 31) audio.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            else !audio.isSpeakerphoneOn && !audio.isBluetoothScoOn && !audio.isWiredHeadsetOn
        val enabled = state.call != null && nativeCallUsesProximity(state.connected, earpiece, state.cameraEnabled || state.remoteVideo, state.sharing || state.remoteSharing)
        val power = getSystemService(PowerManager::class.java)
        if (enabled && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            if (proximityLock == null) proximityLock = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Volna:Proximity").apply { setReferenceCounted(false) }
            if (proximityLock?.isHeld == false) runCatching { proximityLock?.acquire() }
        } else releaseProximity()
    }

    private fun releaseProximity() {
        proximityLock?.let { if (it.isHeld) runCatching { it.release() } }
        proximityLock = null
    }

    private fun updateForeground() {
        val state = NativeCalls.state.value
        val open = IncomingCallActivity.pending(this, state.call?.id ?: return)
        val end = PendingIntent.getBroadcast(this, 11032, Intent(this, CallActionReceiver::class.java).setAction(ACTION_END).putExtra("call_id", state.call?.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_volna)
            .setContentTitle(state.call?.peer?.name ?: "Волна")
            .setContentText(if (projecting) "Демонстрация экрана · звонок продолжается" else state.phase.ifBlank { "Звонок продолжается" })
            .setCategory(Notification.CATEGORY_CALL).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setWhen(System.currentTimeMillis() - state.elapsed * 1000L).setUsesChronometer(state.connected)
            .addAction(Notification.Action.Builder(null, "Завершить", end).build()).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or (if (projecting) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0) or (if (cameraActive) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0))
        else startForeground(ID, notification)
    }

    override fun onDestroy() {
        serviceScope.cancel()
        val audio = getSystemService(AudioManager::class.java)
        audio.unregisterAudioDeviceCallback(devices)
        if (Build.VERSION.SDK_INT >= 31) communicationChanged?.let { audio.removeOnCommunicationDeviceChangedListener(it) }
        releaseProximity()
        val owning = instance === this
        if (owning) instance = null
        wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (owning && NativeCalls.state.value.call != null) NativeCalls.end("Фоновый звонок остановлен")
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_END = "dev.volna.messenger.END_CALL"
        private const val ACTION_SCREEN = "dev.volna.messenger.SHARE_SCREEN"
        private const val CHANNEL = "volna_active_call"
        private const val ID = 11032
        private var instance: CallService? = null
        private var ready: CompletableDeferred<CallService>? = null
        suspend fun ensureReady(context: Context) {
            if (instance != null) return
            check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Разрешите микрофон для звонка" }
            val pending = CompletableDeferred<CallService>().also { ready = it }
            try {
                context.startForegroundService(Intent(context, CallService::class.java))
                check(withTimeoutOrNull(5_000) { pending.await() } != null) { "Android не запустил сервис звонка. Откройте приложение и повторите вызов." }
            } finally { if (ready === pending) ready = null }
        }
        fun requestScreen(context: Context, data: Intent) {
            context.startService(Intent(context, CallService::class.java).setAction(ACTION_SCREEN).putExtra("screen_data", data))
        }
        fun projectionStopped() { instance?.let { it.projecting = false; if (NativeCalls.state.value.call != null) runCatching { it.updateForeground() } } }
        fun cameraStarted() { val service = instance ?: error("Сервис звонка не запущен"); service.cameraActive = true; service.updateForeground() }
        fun cameraStopped() { instance?.let { it.cameraActive = false; if (NativeCalls.state.value.call != null) runCatching { it.updateForeground() } } }
        fun refresh() { instance?.let { runCatching { it.updateForeground() } } }
        fun stop(context: Context) { instance = null; ready?.completeExceptionally(IllegalStateException("Звонок завершён")); ready = null; context.stopService(Intent(context, CallService::class.java)) }
    }
}

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == CallService.ACTION_END && intent.getStringExtra("call_id") == NativeCalls.state.value.call?.id) NativeCalls.end()
    }
}

/** The native proximity wake lock handles near/far automatically, including while minimized. */
internal fun nativeCallUsesProximity(connected: Boolean, earpiece: Boolean, video: Boolean, sharing: Boolean) = connected && earpiece && !video && !sharing
