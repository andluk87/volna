package dev.volna.messenger

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.ToneGenerator
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.projection.MediaProjection
import android.os.Build
import android.os.SystemClock
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.roundToInt

data class NativeCallState(
    val call: VolnaCall? = null, val phase: String = "", val error: String = "",
    val muted: Boolean = false, val sharing: Boolean = false, val remoteSharing: Boolean = false,
    val minimized: Boolean = false, val connected: Boolean = false, val screenReady: Boolean = false,
    val elapsed: Int = 0, val relay: Boolean = true, val route: String = "Телефон", val busy: Boolean = false,
    val cameraEnabled: Boolean = false, val cameraFront: Boolean = true, val remoteVideo: Boolean = false
)
data class NativeAudioRoute(val id: Int, val label: String)

/** Owns media independently of Compose and the activity. The foreground service keeps it alive. */
object NativeCalls {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + CoroutineExceptionHandler { _, problem ->
        NativeCallDiagnostics.failure(problem)
        end("Ошибка звонка: ${problem.message ?: problem.javaClass.simpleName}")
    })
    private val mutableState = MutableStateFlow(NativeCallState())
    val state: StateFlow<NativeCallState> = mutableState
    private var context: Context? = null
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL) }
    private var token = ""
    private var device = ""
    private var generation = 0
    private var pollJob: Job? = null
    private var clockJob: Job? = null
    private var operation: Job? = null
    private var connectedAt = 0L
    private var attemptAt = 0L
    private var disconnectedAt = 0L
    @Volatile private var lastVideoFrame = 0L
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var egl: EglBase? = null
    val eglContext: EglBase.Context? get() = egl?.eglBaseContext
    private var audioModule: JavaAudioDeviceModule? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var screenRequested = false
    private var textureHelper: SurfaceTextureHelper? = null
    private var remoteTrack: VideoTrack? = null
    private var cameraCapturer: CameraVideoCapturer? = null
    private var cameraSource: VideoSource? = null
    private var cameraTrack: VideoTrack? = null
    private var cameraTexture: SurfaceTextureHelper? = null
    private val localVideoSinks = mutableSetOf<VideoSink>()
    private var cameraWanted = false
    private val videoSinks = mutableSetOf<VideoSink>()
    private var focus: AudioFocusRequest? = null
    private var originalMode = AudioManager.MODE_NORMAL
    private var originalSpeaker = false
    private var ringtone: Ringtone? = null
    private var toneObserver: Job? = null
    private var ringbackJob: Job? = null
    private var ringback: ToneGenerator? = null
    private var initialized = false
    private val frameObserver = VideoSink { lastVideoFrame = SystemClock.elapsedRealtime() }

    fun configure(appContext: Context, sessionToken: String) {
        if (context != null && token == sessionToken) return
        end()
        pollJob?.cancel()
        clockJob?.cancel()
        toneObserver?.cancel()
        stopRingback()
        context = appContext.applicationContext
        token = sessionToken
        val prefs = appContext.getSharedPreferences("volna-native", 0)
        device = prefs.getString("call_device", null)?.takeIf { it.matches(Regex("[a-f0-9]{32}")) }
            ?: UUID.randomUUID().toString().replace("-", "").also { prefs.edit().putString("call_device", it).apply() }
        if (token.isBlank()) return
        toneObserver = scope.launch {
            state.map { it.call?.let { call -> !call.incoming && call.status == "ringing" && !it.connected } == true }
                .distinctUntilChanged().collect { waiting -> if (waiting) startRingback() else stopRingback() }
        }
        clockJob = scope.launch { while (isActive) { updateClock(); delay(1_000) } }
        pollJob = scope.launch {
            var lastSuccess = SystemClock.elapsedRealtime()
            while (isActive) {
                val version = generation
                try {
                    val current = withContext(Dispatchers.IO) { api.currentCall(token, device) }
                    if (version == generation && operation?.isActive != true) {
                        lastSuccess = SystemClock.elapsedRealtime()
                        applyCurrent(current)
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) {
                    if (version == generation && state.value.call != null && SystemClock.elapsedRealtime() - lastSuccess > 35_000) end("Нет связи с сервером")
                }
                delay(2_000)
            }
        }
    }

    private suspend fun applyCurrent(current: VolnaCall?) {
        val version = generation
        if (current == null) { if (state.value.call != null) end(); return }
        if (current.status == "other-device") { if (state.value.call != null) end("Звонок открыт на другом устройстве", notifyServer = false); return }
        val existing = state.value.call
        if (existing == null) {
            if (current.incoming && current.status == "ringing") {
                mutableState.value = NativeCallState(call = current, phase = "Входящий звонок")
                ring(current)
            } else {
                // A process restart cannot restore old DTLS keys. Release an abandoned device call.
                withContext(Dispatchers.IO) { api.callAction(token, device, current.id, "end") }
            }
            return
        }
        if (existing.id != current.id) { end(notifyServer = false); return }
        mutableState.update { it.copy(call = current) }
        if (cameraWanted && current.status == "active" && state.value.connected && state.value.screenReady) { cameraWanted = false; setCamera(true) }
        val pc = peer
        if (!current.incoming && current.answer != null && pc != null && pc.remoteDescription == null) {
            try { setDescription(pc, current.answer, local = false) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) {
                if (version == generation) { NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось согласовать звонок") }
                return
            }
            if (version != generation || peer !== pc) return
            updateScreenReady()
            if (!state.value.connected) NativeCallDiagnostics.step("Установка ответа завершена, ожидание соединения ICE")
            mutableState.update { if (it.connected) it else it.copy(phase = "Соединяем…") }
        }
        if (pc != null && !state.value.connected && SystemClock.elapsedRealtime() - attemptAt > 60_000) end("Не удалось соединиться. Проверьте сеть и TURN")
    }

    fun start(chat: VolnaChat, video: Boolean = false) {
        if (token.isBlank() || state.value.call != null || operation?.isActive == true) return
        if (chat.kind != "direct" || chat.saved) return
        val session = token
        val version = ++generation
        cameraWanted = video
        NativeCallDiagnostics.begin()
        mutableState.value = NativeCallState(phase = "Подготовка звонка…", busy = true)
        operation = scope.launch {
            var created: VolnaCall? = null
            try {
                NativeCallDiagnostics.step("Создание звонка на сервере")
                withContext(Dispatchers.IO) { created = api.startCall(session, device, chat.id, video) }
                checkVersion(version)
                val call = created ?: error("Сервер не создал звонок")
                mutableState.update { it.copy(call = call) }
                val pc = prepare(version)
                val description = createDescription(pc, offer = true)
                setDescription(pc, description, local = true)
                gather(pc)
                checkVersion(version)
                NativeCallDiagnostics.step("Передача предложения звонка на сервер")
                val ready = withContext(Dispatchers.IO) { api.callAction(session, device, call.id, "offer", localDescription(pc)) }
                checkVersion(version)
                mutableState.update { it.copy(call = ready, phase = "Вызываем…", busy = false) }
                NativeCallDiagnostics.step("Ожидание ответа собеседника")
            } catch (cancelled: CancellationException) {
                created?.let { call -> scope.launch(Dispatchers.IO) { runCatching { api.callAction(session, device, call.id, "end") } } }
                throw cancelled
            } catch (problem: Exception) { if (version == generation) { NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось начать звонок") } }
            catch (problem: LinkageError) { if (version == generation) { NativeCallDiagnostics.failure(problem); end("Не удалось загрузить WebRTC. Откройте диагностику звонка и обновите приложение.") } }
            finally { if (version == generation) mutableState.update { it.copy(busy = false) } }
        }
    }

    fun accept(video: Boolean = false) {
        val call = state.value.call ?: return
        if (!call.incoming || call.status != "ringing" || operation?.isActive == true) return
        val version = ++generation
        NativeCallDiagnostics.begin()
        stopRinging()
        cameraWanted = video
        mutableState.update { it.copy(phase = "Подключаем микрофон…", busy = true) }
        operation = scope.launch {
            try {
                val accepted = withContext(Dispatchers.IO) { api.callAction(token, device, call.id, "accept") }
                checkVersion(version)
                mutableState.update { it.copy(call = accepted) }
                val pc = prepare(version)
                setDescription(pc, call.offer ?: error("Нет предложения звонка"), local = false)
                setDescription(pc, createDescription(pc, offer = false), local = true)
                gather(pc)
                checkVersion(version)
                NativeCallDiagnostics.step("Передача ответа звонка на сервер")
                val ready = withContext(Dispatchers.IO) { api.callAction(token, device, call.id, "answer", localDescription(pc)) }
                checkVersion(version)
                mutableState.update { it.copy(call = ready, phase = if (it.connected) "Разговор" else "Соединяем…", busy = false) }
                updateScreenReady()
                if (!state.value.connected) NativeCallDiagnostics.step("Ожидание соединения ICE")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { if (version == generation) { NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось принять звонок") } }
            catch (problem: LinkageError) { if (version == generation) { NativeCallDiagnostics.failure(problem); end("Не удалось загрузить WebRTC. Откройте диагностику звонка и обновите приложение.") } }
            finally { if (version == generation) mutableState.update { it.copy(busy = false) } }
        }
    }

    private suspend fun prepare(version: Int): PeerConnection {
        val app = context ?: error("Приложение не запущено")
        // NetworkMonitor queries ConnectivityManager from JNI during ICE. An uncaught
        // SecurityException there aborts the native network thread instead of reaching Kotlin.
        NativeCallDiagnostics.step("Проверка разрешений сети")
        check(app.checkSelfPermission(Manifest.permission.ACCESS_NETWORK_STATE) == PackageManager.PERMISSION_GRANTED) {
            "В установленной сборке отсутствует разрешение ACCESS_NETWORK_STATE. Обновите приложение Волна."
        }
        NativeCallDiagnostics.step("Получение настроек ICE/TURN")
        val config = withContext(Dispatchers.IO) { api.callConfig(token) }
        checkVersion(version)
        NativeCallDiagnostics.step("Запуск сервиса микрофона")
        CallService.ensureReady(app)
        checkVersion(version)
        NativeCallDiagnostics.step("Получение аудиофокуса")
        beginAudio(app)
        NativeCallDiagnostics.step("Загрузка WebRTC")
        if (!initialized) {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions())
            initialized = true
        }
        // An audio call can proceed even if a device cannot create a shared EGL context.
        if (egl == null) runCatching { egl = EglBase.create() }
        NativeCallDiagnostics.step("Подготовка аудиоустройства WebRTC")
        val module = JavaAudioDeviceModule.builder(app)
            .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
            .setAudioRecordErrorCallback(object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                override fun onWebRtcAudioRecordInitError(message: String) = mediaFailure(version, "Не удалось открыть микрофон", message)
                override fun onWebRtcAudioRecordStartError(code: JavaAudioDeviceModule.AudioRecordStartErrorCode, message: String) = mediaFailure(version, "Не удалось включить микрофон", message)
                override fun onWebRtcAudioRecordError(message: String) = mediaFailure(version, "Микрофон недоступен", message)
            })
            .setAudioTrackErrorCallback(object : JavaAudioDeviceModule.AudioTrackErrorCallback {
                override fun onWebRtcAudioTrackInitError(message: String) = mediaFailure(version, "Не удалось открыть динамик", message)
                override fun onWebRtcAudioTrackStartError(code: JavaAudioDeviceModule.AudioTrackStartErrorCode, message: String) = mediaFailure(version, "Не удалось включить динамик", message)
                override fun onWebRtcAudioTrackError(message: String) = mediaFailure(version, "Динамик недоступен", message)
            }).createAudioDeviceModule()
        audioModule = module
        NativeCallDiagnostics.step("Подготовка программного видеокодека VP8")
        val encoder = CallVideoEncoderFactory()
        val decoder = CallVideoDecoderFactory()
        check(encoder.getSupportedCodecs().isNotEmpty() && decoder.getSupportedCodecs().isNotEmpty()) { "WebRTC не содержит кодек VP8 для показа экрана" }
        val mediaFactory = PeerConnectionFactory.builder().setAudioDeviceModule(module)
            .setVideoEncoderFactory(encoder).setVideoDecoderFactory(decoder).createPeerConnectionFactory()
        factory = mediaFactory
        val servers = config.optJSONArray("iceServers")
        val iceServers = mutableListOf<PeerConnection.IceServer>()
        if (servers != null) for (i in 0 until servers.length()) {
            val server = servers.getJSONObject(i)
            val urls = server.optJSONArray("urls")
            val addresses = if (urls != null) (0 until urls.length()).map { urls.getString(it) } else listOf(server.getString("urls"))
            iceServers += PeerConnection.IceServer.builder(addresses).setUsername(server.optString("username")).setPassword(server.optString("credential")).createIceServer()
        }
        val rtc = PeerConnection.RTCConfiguration(iceServers).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        NativeCallDiagnostics.step("Создание соединения WebRTC")
        val pc = mediaFactory.createPeerConnection(rtc, observer(version)) ?: error("Не удалось создать WebRTC")
        peer = pc
        NativeCallDiagnostics.step("Создание дорожки микрофона")
        val source = mediaFactory.createAudioSource(MediaConstraints().apply {
            optional.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            optional.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
        })
        audioSource = source
        val track = mediaFactory.createAudioTrack("volna-audio", source)
        audioTrack = track
        checkNotNull(pc.addTrack(track, listOf("volna"))) { "Не удалось подключить микрофон к звонку" }
        NativeCallDiagnostics.step("Добавление канала демонстрации экрана")
        checkNotNull(pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf("volna")))) { "Не удалось подготовить видеоканал" }
        attemptAt = SystemClock.elapsedRealtime()
        mutableState.update { it.copy(relay = config.optBoolean("relayConfigured")) }
        return pc
    }

    private fun mediaFailure(version: Int, label: String, detail: String) {
        scope.launch {
            if (version != generation) return@launch
            NativeCallDiagnostics.failure(IllegalStateException(detail))
            end("$label. Проверьте разрешения и закройте другие приложения, использующие звук.")
        }
    }

    private fun observer(version: Int) = object : PeerConnection.Observer {
        override fun onSignalingChange(value: PeerConnection.SignalingState?) { }
        override fun onIceConnectionChange(value: PeerConnection.IceConnectionState?) { }
        override fun onIceConnectionReceivingChange(value: Boolean) { }
        override fun onIceGatheringChange(value: PeerConnection.IceGatheringState?) { }
        override fun onIceCandidate(value: IceCandidate?) { }
        override fun onIceCandidatesRemoved(values: Array<out IceCandidate>?) { }
        override fun onAddStream(value: MediaStream?) { }
        override fun onRemoveStream(value: MediaStream?) { }
        override fun onDataChannel(value: DataChannel?) { }
        override fun onRenegotiationNeeded() { }
        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) { receiveTrack(receiver?.track(), version) }
        override fun onTrack(transceiver: RtpTransceiver?) { receiveTrack(transceiver?.receiver?.track(), version) }
        override fun onConnectionChange(value: PeerConnection.PeerConnectionState?) {
            scope.launch {
                if (version != generation) return@launch
                when (value) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        disconnectedAt = 0L
                        if (connectedAt == 0L) connectedAt = SystemClock.elapsedRealtime()
                        mutableState.update { it.copy(connected = true, phase = "Разговор") }
                        NativeCallDiagnostics.step("Звонок соединён")
                        updateScreenReady()
                        if (cameraWanted && state.value.call?.status == "active") { cameraWanted = false; setCamera(true) }
                    }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> { disconnectedAt = SystemClock.elapsedRealtime(); mutableState.update { it.copy(connected = false, phase = "Восстанавливаем соединение…") } }
                    PeerConnection.PeerConnectionState.FAILED -> end("Соединение звонка потеряно")
                    else -> Unit
                }
            }
        }
    }

    private fun receiveTrack(track: MediaStreamTrack?, version: Int) {
        if (track !is VideoTrack) return
        scope.launch {
            if (version != generation || remoteTrack === track) return@launch
            remoteTrack?.let { old -> runCatching { old.removeSink(frameObserver); videoSinks.forEach(old::removeSink) } }
            remoteTrack = track
            track.addSink(frameObserver)
            videoSinks.forEach(track::addSink)
        }
    }

    fun attachVideo(sink: VideoSink) { videoSinks.add(sink); remoteTrack?.addSink(sink) }
    fun detachVideo(sink: VideoSink) { videoSinks.remove(sink); remoteTrack?.let { runCatching { it.removeSink(sink) } } }
    fun attachLocalVideo(sink: VideoSink) { localVideoSinks.add(sink); cameraTrack?.addSink(sink) }
    fun detachLocalVideo(sink: VideoSink) { localVideoSinks.remove(sink); cameraTrack?.let { runCatching { it.removeSink(sink) } } }
    fun switchCamera() { runCatching { cameraCapturer?.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
        override fun onCameraSwitchDone(isFrontCamera: Boolean) { mutableState.update { it.copy(cameraFront = isFrontCamera) } }
        override fun onCameraSwitchError(error: String) { mutableState.update { it.copy(error = "Не удалось сменить камеру") } }
    }) } }
    fun setCamera(enabled: Boolean) {
        if (!enabled) { stopCamera(); return }
        if (state.value.cameraEnabled || !state.value.connected || !state.value.screenReady) return
        try {
            val app = context ?: error("Звонок завершён")
            check(app.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { "Разрешите доступ к камере" }
            if (state.value.sharing) stopScreenSharing()
            CallService.cameraStarted()
            val mediaFactory = factory ?: error("Звонок завершён")
            val enumerator = Camera2Enumerator(app)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.firstOrNull() ?: error("Камера не найдена")
            val capture = enumerator.createCapturer(name, null) ?: error("Камера недоступна")
            cameraCapturer = capture
            val source = mediaFactory.createVideoSource(false).also { cameraSource = it }
            val helper = SurfaceTextureHelper.create("volna-camera", eglContext ?: error("Видеоустройство недоступно")) ?: error("Камера недоступна")
            cameraTexture = helper
            capture.initialize(helper, app, source.capturerObserver)
            source.adaptOutputFormat(640, 480, 24); capture.startCapture(640, 480, 24)
            val track = mediaFactory.createVideoTrack("volna-camera", source).also { cameraTrack = it }
            val sender = videoSender() ?: error("Видеоканал недоступен")
            check(sender.setTrack(track, false)) { "Не удалось включить камеру" }
            localVideoSinks.forEach(track::addSink)
            val parameters = sender.parameters
            parameters.encodings.forEach { it.maxBitrateBps = 800_000; it.maxFramerate = 24 }; sender.setParameters(parameters)
            mutableState.update { it.copy(cameraEnabled = true, cameraFront = enumerator.isFrontFacing(name), error = "") }
            signalCamera(true)
        } catch (problem: Exception) { stopCamera(); mutableState.update { it.copy(error = problem.message ?: "Не удалось включить камеру") } }
    }
    private fun stopCamera() {
        val enabled = state.value.cameraEnabled
        if (cameraCapturer == null && !enabled) { CallService.cameraStopped(); return }
        runCatching { videoSender()?.setTrack(null, false) }
        val capture = cameraCapturer; cameraCapturer = null; runCatching { capture?.stopCapture() }; runCatching { capture?.dispose() }
        val track = cameraTrack; cameraTrack = null; runCatching { if (track != null) { localVideoSinks.forEach(track::removeSink); track.dispose() } }
        val source = cameraSource; cameraSource = null; runCatching { source?.dispose() }
        val helper = cameraTexture; cameraTexture = null; runCatching { helper?.dispose() }
        mutableState.update { it.copy(cameraEnabled = false) }; CallService.cameraStopped()
        if (enabled) signalCamera(false)
    }
    private fun signalCamera(enabled: Boolean) {
        val call = state.value.call ?: return
        val session = token
        scope.launch(Dispatchers.IO) { runCatching { api.callCamera(session, device, call.id, enabled) } }
    }
    fun minimize(value: Boolean) { mutableState.update { it.copy(minimized = value) } }
    fun clearError() { mutableState.update { it.copy(error = "") }; NativeCallDiagnostics.clear() }
    fun toggleMute() { val muted = !state.value.muted; audioTrack?.setEnabled(!muted); mutableState.update { it.copy(muted = muted) } }

    fun startScreenSharing(data: Intent) {
        if (!state.value.connected || !state.value.screenReady || state.value.sharing || screenRequested) return
        val app = context ?: return
        if (state.value.cameraEnabled) stopCamera()
        screenRequested = true
        try { CallService.requestScreen(app, data) }
        catch (problem: Exception) { screenRequested = false; mutableState.update { it.copy(error = problem.message ?: "Не удалось запустить демонстрацию") } }
    }

    /** Called only after CallService has enabled its mediaProjection foreground type. */
    fun captureScreen(data: Intent) {
        screenRequested = false
        if (capturer != null) return
        if (!state.value.connected || !state.value.screenReady) { CallService.projectionStopped(); return }
        try {
            val version = generation
            val app = context ?: error("Приложение не запущено")
            val mediaFactory = factory ?: error("Звонок завершён")
            val source = mediaFactory.createVideoSource(true).also { videoSource = it }
            val helper = (SurfaceTextureHelper.create("volna-screen", eglContext ?: error("Звонок завершён")) ?: error("Не удалось подготовить захват экрана")).also { textureHelper = it }
            val capture = ScreenCapturerAndroid(data, object : MediaProjection.Callback() {
                override fun onStop() { scope.launch { if (version == generation) stopScreenSharing() } }
                override fun onCapturedContentResize(width: Int, height: Int) { scope.launch { if (version == generation) resizeScreen(width, height) } }
            }).also { capturer = it }
            capture.initialize(helper, app, source.capturerObserver)
            val metrics = app.resources.displayMetrics
            val (width, height) = captureSize(metrics.widthPixels, metrics.heightPixels)
            source.adaptOutputFormat(width, height, 15)
            capture.startCapture(width, height, 15)
            val track = mediaFactory.createVideoTrack("volna-screen", source).also { screenTrack = it }
            val sender = videoSender() ?: error("Собеседник не поддерживает демонстрацию экрана")
            if (!sender.setTrack(track, false)) error("Не удалось подключить экран к звонку")
            val parameters = sender.parameters
            parameters.encodings.forEach { it.maxBitrateBps = 1_200_000; it.maxFramerate = 15 }
            sender.setParameters(parameters)
            mutableState.update { it.copy(sharing = true) }
            signalScreen(true)
        } catch (problem: Exception) { stopScreenSharing(); mutableState.update { it.copy(error = problem.message ?: "Не удалось показать экран") } }
    }

    fun stopScreenSharing() {
        screenRequested = false
        val wasSharing = state.value.sharing
        runCatching { videoSender()?.setTrack(null, false) }
        val old = capturer; capturer = null
        runCatching { old?.stopCapture() }; runCatching { old?.dispose() }
        val track = screenTrack; screenTrack = null; runCatching { track?.dispose() }
        val source = videoSource; videoSource = null; runCatching { source?.dispose() }
        val helper = textureHelper; textureHelper = null; runCatching { helper?.dispose() }
        mutableState.update { it.copy(sharing = false) }
        if (wasSharing) signalScreen(false)
        CallService.projectionStopped()
    }

    private fun signalScreen(sharing: Boolean) {
        val call = state.value.call ?: return
        val session = token; val version = generation
        scope.launch {
            try { withContext(Dispatchers.IO) { api.callScreen(session, device, call.id, sharing) } }
            catch (problem: Exception) { if (sharing && version == generation && state.value.sharing) { stopScreenSharing(); mutableState.update { it.copy(error = "Сервер не подтвердил демонстрацию. Обновите Волну и попробуйте ещё раз.") } } }
        }
    }

    private fun captureSize(width: Int, height: Int): Pair<Int, Int> {
        val scale = (1280f / maxOf(width, height).coerceAtLeast(1)).coerceAtMost(1f)
        return ((width * scale / 2).roundToInt() * 2).coerceAtLeast(2) to ((height * scale / 2).roundToInt() * 2).coerceAtLeast(2)
    }
    fun resizeScreen(width: Int, height: Int) {
        if (capturer == null) return
        val (w, h) = captureSize(width, height)
        videoSource?.adaptOutputFormat(w, h, 15)
        runCatching { capturer?.changeCaptureFormat(w, h, 15) }
    }
    private fun videoSender(): RtpSender? = peer?.transceivers?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }?.sender
    private fun updateScreenReady() {
        val video = peer?.transceivers?.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }
        mutableState.update { it.copy(screenReady = video?.currentDirection in listOf(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, RtpTransceiver.RtpTransceiverDirection.SEND_ONLY)) }
    }

    fun routes(): List<NativeAudioRoute> {
        val manager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return emptyList()
        if (Build.VERSION.SDK_INT >= 31) return runCatching { manager.availableCommunicationDevices.map { NativeAudioRoute(it.id, routeName(it)) } }.getOrDefault(emptyList())
        return listOf(NativeAudioRoute(-1, "Телефон / гарнитура"), NativeAudioRoute(-2, "Динамик"))
    }
    fun selectRoute(id: Int) {
        val manager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val route = manager.availableCommunicationDevices.firstOrNull { it.id == id } ?: error("Устройство отключено")
                if (!manager.setCommunicationDevice(route)) error("Не удалось переключить аудиовыход")
                mutableState.update { it.copy(route = routeName(route)) }
            } else { manager.isSpeakerphoneOn = id == -2; mutableState.update { it.copy(route = if (id == -2) "Динамик" else "Телефон / гарнитура") } }
        } catch (problem: Exception) { mutableState.update { it.copy(error = problem.message ?: "Не удалось выбрать динамик") } }
    }
    private fun routeName(device: AudioDeviceInfo): String = when (device.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Динамик"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Телефон"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Гарнитура"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "USB-гарнитура"
        else -> "Аудиоустройство"
    }
    private fun beginAudio(app: Context) {
        val version = generation
        val manager = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        originalMode = manager.mode; originalSpeaker = manager.isSpeakerphoneOn
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener { value -> scope.launch {
                if (version != generation) return@launch
                when (value) {
                    AudioManager.AUDIOFOCUS_LOSS -> end("Звук занят другим звонком")
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { audioTrack?.setEnabled(false); mutableState.update { it.copy(phase = "Звук временно занят") } }
                    AudioManager.AUDIOFOCUS_GAIN -> { audioTrack?.setEnabled(!state.value.muted); if (state.value.connected) mutableState.update { it.copy(phase = "Разговор") } }
                }
            } }.build()
        if (manager.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) error("Не удалось получить доступ к звуку")
        focus = request; manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) mutableState.update { it.copy(route = runCatching { manager.communicationDevice?.let(::routeName) }.getOrNull() ?: "Телефон") }
    }

    fun end(message: String = "", notifyServer: Boolean = true) {
        val call = state.value.call; val session = token
        generation++
        operation?.cancel(); operation = null
        stopRinging()
        cameraWanted = false
        stopCamera()
        stopScreenSharing()
        remoteTrack?.let { track -> runCatching { track.removeSink(frameObserver); videoSinks.forEach(track::removeSink) } }; remoteTrack = null
        NativeCallDiagnostics.step("Освобождение соединения WebRTC")
        runCatching { peer?.close() }; runCatching { peer?.dispose() }; peer = null
        val track = audioTrack; audioTrack = null; runCatching { track?.dispose() }
        val source = audioSource; audioSource = null; runCatching { source?.dispose() }
        NativeCallDiagnostics.step("Освобождение фабрики WebRTC")
        val oldFactory = factory; factory = null; runCatching { oldFactory?.dispose() }
        NativeCallDiagnostics.step("Освобождение аудиоустройства")
        val module = audioModule; audioModule = null; runCatching { module?.release() }
        (context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.let { manager ->
            focus?.let { request ->
                runCatching { manager.abandonAudioFocusRequest(request) }
                if (Build.VERSION.SDK_INT >= 31) runCatching { manager.clearCommunicationDevice() }
                runCatching { manager.isSpeakerphoneOn = originalSpeaker }
                runCatching { manager.mode = originalMode }
            }
        }
        focus = null; connectedAt = 0L; disconnectedAt = 0L; lastVideoFrame = 0L
        mutableState.value = NativeCallState(error = message)
        NativeCallDiagnostics.finish(message)
        context?.let { runCatching { CallService.stop(it) } }
        if (notifyServer && call != null && session.isNotBlank()) scope.launch(Dispatchers.IO) { runCatching { api.callAction(session, device, call.id, "end") } }
    }

    private fun updateClock() {
        val now = SystemClock.elapsedRealtime()
        if (disconnectedAt > 0 && now - disconnectedAt > 25_000) { end("Соединение звонка потеряно"); return }
        mutableState.update { it.copy(elapsed = if (connectedAt > 0) ((now - connectedAt) / 1000).toInt() else 0,
            remoteSharing = it.call?.peerSharing ?: (lastVideoFrame > 0 && now - lastVideoFrame < 4_000),
            remoteVideo = it.call?.peerVideo == true || it.call?.peerSharing != true && lastVideoFrame > 0 && now - lastVideoFrame < 4_000) }
        if (state.value.call != null) CallService.refresh()
    }
    private fun checkVersion(version: Int) { if (version != generation) throw CancellationException("Звонок отменён") }
    private suspend fun gather(pc: PeerConnection) {
        NativeCallDiagnostics.step("Сбор сетевых кандидатов ICE")
        withTimeoutOrNull(10_000) { while (peer === pc && pc.iceGatheringState() != PeerConnection.IceGatheringState.COMPLETE) delay(80) }
    }
    private fun localDescription(pc: PeerConnection): JSONObject = pc.localDescription.let { JSONObject().put("type", it.type.canonicalForm()).put("sdp", it.description) }
    private suspend fun createDescription(pc: PeerConnection, offer: Boolean): JSONObject {
        val type = if (offer) "offer" else "answer"
        NativeCallDiagnostics.step("Создание локального SDP $type")
        check(peer === pc) { "Звонок завершён" }
        return withTimeoutOrNull(15_000) {
            suspendCancellableCoroutine<JSONObject> { result ->
                val observer = object : SdpObserver {
                    override fun onCreateSuccess(description: SessionDescription?) { if (result.isActive) { if (description == null) result.resumeWithException(IllegalStateException("Нет SDP")) else result.resume(JSONObject().put("type", description.type.canonicalForm()).put("sdp", description.description)) } }
                    override fun onCreateFailure(message: String?) { if (result.isActive) result.resumeWithException(IllegalStateException(message ?: "Не удалось подготовить звонок")) }
                    override fun onSetSuccess() { }
                    override fun onSetFailure(message: String?) { }
                }
                if (offer) pc.createOffer(observer, MediaConstraints()) else pc.createAnswer(observer, MediaConstraints())
            }
        } ?: error("WebRTC не создал SDP $type за 15 секунд. Повторите звонок.")
    }
    private suspend fun setDescription(pc: PeerConnection, data: JSONObject, local: Boolean) {
        val type = data.getString("type")
        NativeCallDiagnostics.step("Установка ${if (local) "локального" else "удалённого"} SDP $type")
        check(peer === pc) { "Звонок завершён" }
        val description = SessionDescription(SessionDescription.Type.fromCanonicalForm(type), data.getString("sdp"))
        val completed = withTimeoutOrNull(15_000) {
            suspendCancellableCoroutine<Unit> { result ->
                val observer = object : SdpObserver {
                    override fun onSetSuccess() { if (result.isActive) result.resume(Unit) }
                    override fun onSetFailure(message: String?) { if (result.isActive) result.resumeWithException(IllegalStateException(message ?: "Ошибка параметров звонка")) }
                    override fun onCreateSuccess(description: SessionDescription?) { }
                    override fun onCreateFailure(message: String?) { }
                }
                if (local) pc.setLocalDescription(observer, description) else pc.setRemoteDescription(observer, description)
            }
        }
        if (completed == null && peer === pc) error("WebRTC не установил SDP $type за 15 секунд. Повторите звонок.")
    }

    private fun ring(call: VolnaCall) {
        val app = context ?: return
        runCatching { CallAlerts.show(app, call) }
        ringtone = RingtoneManager.getRingtone(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.also {
            if (Build.VERSION.SDK_INT >= 28) it.isLooping = true
            runCatching { it.play() }
        }
    }
    private fun stopRinging() {
        stopRingback()
        val old = ringtone; ringtone = null; runCatching { old?.stop() }
        runCatching { context?.getSystemService(NotificationManager::class.java)?.cancel(CALL_NOTIFICATION) }
    }
    private fun startRingback() {
        stopRingback()
        ringback = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 55) }.getOrNull() ?: return
        ringbackJob = scope.launch { while (isActive) { runCatching { ringback?.startTone(ToneGenerator.TONE_SUP_RINGTONE, 1_000) }; delay(4_000) } }
    }
    private fun stopRingback() {
        ringbackJob?.cancel(); ringbackJob = null
        val tone = ringback; ringback = null
        runCatching { tone?.stopTone(); tone?.release() }
    }
    const val CALL_CHANNEL = "volna_incoming_calls"
    const val CALL_NOTIFICATION = 11031
}
