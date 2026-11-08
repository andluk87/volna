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
    val elapsed: Int = 0, val relay: Boolean = true, val route: String = "Телефон", val routePending:Boolean=false, val busy: Boolean = false,
    val cameraPreview: Boolean = false, val cameraEnabled: Boolean = false, val cameraFront: Boolean = true, val remoteVideo: Boolean = false, val safetyCode: String = ""
)
data class NativeAudioRoute(val id: Int, val label: String)

/** Owns media independently of Compose and the activity. The foreground service keeps it alive. */
object NativeCalls {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + CoroutineExceptionHandler { _, problem ->
        diagnosticFailure(problem);NativeCallDiagnostics.failure(problem)
        end("Ошибка звонка: ${problem.message ?: problem.javaClass.simpleName}", reason="uncaught_error")
    })
    private val mutableState = MutableStateFlow(NativeCallState())
    val state: StateFlow<NativeCallState> = mutableState
    private var context: Context? = null
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL,requestTimeoutSeconds=15) }
    private val endApi by lazy { NativeApi(BuildConfig.API_BASE_URL,requestTimeoutSeconds=5) }
    private var endQueue:NativeCallEndOutbox?=null
    private fun flushEnds(force:Boolean=false,queue:NativeCallEndOutbox?=endQueue,session:String=token){
        if(queue==null||session.isBlank())return
        scope.launch(Dispatchers.IO){queue.flush(force){value->endApi.callAction(session,value.getString("device"),value.getString("call_id"),"end",endReason=value.optString("end_reason"))}}
    }
    private var recoveryErrorAt=0L
    private fun recoveryFailure(problem:Exception,epoch:Int){val now=SystemClock.elapsedRealtime();if(recoveryErrorAt==0L||now-recoveryErrorAt>=5000){recoveryErrorAt=now;diagnosticFailure(problem,"restart",epoch)}}

    @Volatile private var token = ""
    internal fun accountId():Long = NativeCredentials.accountId(token)
    internal fun configuredFor(session: String) = nativeSameCallSession(token,session,NativeCredentials::resolve)
    private var device = ""
    private var diagnosticStage = "start"
    private var diagnosticJob: Job? = null
    private fun diagnostic(event:String,fields:JSONObject=JSONObject()) { NativeCallTelemetry.send(token,device,state.value.call?.id,event,networkSnapshot(fields).put("generation",generation)) }
    private fun diagnosticStep(stage:String) { diagnosticStage=stage;diagnostic("client.stage",JSONObject().put("stage",stage)) }
    private fun diagnosticFailure(problem:Throwable,stage:String=diagnosticStage,epoch:Int?=null) { diagnostic("client.error",JSONObject().put("stage",stage).put("error_type",if(problem is LinkageError)"LinkageError" else if(problem is NativeCallTransportException)problem.cause?.javaClass?.simpleName else problem.javaClass.simpleName).apply { if(problem is NativeApiException)put("http_status",problem.status);if(epoch!=null)put("restart_generation",epoch);if(problem is NativeCallTransportException){put("transport_stage",problem.transportStage);put("elapsed_ms",problem.elapsedMs)} }) }
    internal fun debug(action:String,fields:JSONObject=JSONObject(),call:VolnaCall?=state.value.call) { NativeCallTelemetry.send(token,device,call?.id,"client.lifecycle",networkSnapshot(fields).put("generation",generation).put("lifecycle",action).put("has_peer",peer!=null).put("operation_active",operation?.isActive==true).put("call_status",call?.status?:"none")) }
    private fun networkSnapshot(fields:JSONObject):JSONObject {
        runCatching {
            val manager=context?.getSystemService(android.net.ConnectivityManager::class.java)?:return fields
            val caps=manager.getNetworkCapabilities(manager.activeNetwork)
            val transport=when {
                caps==null->"none"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)->"vpn"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)->"wifi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)->"cellular"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)->"ethernet"
                else->"other"
            }
            fields.put("network_transport",transport).put("network_validated",caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)==true).put("network_metered",manager.isActiveNetworkMetered)
        }
        return fields
    }
    private var debugPollAt = 0L
    private var generation = 0
    private val pollWake = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    internal fun serverEvent(session:String,event:JSONObject){scope.launch{
        if(!configuredFor(session))return@launch
        if(event.optString("type")=="call.ended"&&event.optString("call_id")==state.value.call?.id){
            val status=event.optJSONObject("payload")?.optString("status")
            val reason=when(status){"declined"->"server_declined";"interrupted","missed"->"server_interrupted";else->"server_no_call"}
            end(notifyServer=false,reason=reason)
        }else pollWake.trySend(Unit)
    }}
    private suspend fun <T> online(version:()->Int,action:()->T):T = nativeCallNetworkRetry(valid={version()==generation},waiting={if(state.value.call!=null)mutableState.update{it.copy(phase="Ожидаем сеть…")}}){runInterruptible(Dispatchers.IO){action()}}
    private suspend fun <T> online(version:Int,action:()->T):T = online({version},action)
    private fun watchNetwork(){
        val app=context?:return
        if(networkCallback!=null)return
        val manager=app.getSystemService(android.net.ConnectivityManager::class.java)?:return
        fun signature():String{val n=manager.activeNetwork;val c=manager.getNetworkCapabilities(n);return "$n:${c?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)}:${c?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)}"}
        networkSignature=runCatching{signature()}.getOrDefault("")
        networkReady=manager.activeNetwork!=null
        val callback=object:android.net.ConnectivityManager.NetworkCallback(){
            fun changed(){scope.launch{networkDebounce?.cancel();networkDebounce=scope.launch refresh@{
                delay(400);if(token.isBlank())return@refresh
                val current=runCatching{signature()}.getOrDefault("");if(current==networkSignature)return@refresh;networkSignature=current
                networkReady=manager.activeNetwork!=null
                flushEnds(true)
                val call=state.value.call?:return@refresh
                debug(if(networkReady)"network_available" else "network_lost")
                if(call.incoming&&call.status=="ringing"&&operation?.isActive!=true&&audioTrack==null){warmPeer?.job?.cancel();warmPeer=null;releasePeer();warmIncoming(call);return@refresh}
                networkRestartPending=true;rollbackForNetwork=true
                if(networkReady){recoveryJob?.cancel();recoveryJob=null;requestRecovery()}else{if(disconnectedAt==0L)disconnectedAt=SystemClock.elapsedRealtime();mutableState.update{it.copy(connected=false,phase="Ожидаем сеть…")}}
                pollWake.trySend(Unit)
            }}}
            override fun onAvailable(network:android.net.Network)=changed()
            override fun onLost(network:android.net.Network)=changed()
            override fun onCapabilitiesChanged(network:android.net.Network,caps:android.net.NetworkCapabilities)=changed()
        }
        runCatching{manager.registerDefaultNetworkCallback(callback);networkCallback=callback}
    }
    private fun unwatchNetwork(){networkDebounce?.cancel();networkDebounce=null;val callback=networkCallback;networkCallback=null;context?.getSystemService(android.net.ConnectivityManager::class.java)?.let{runCatching{if(callback!=null)it.unregisterNetworkCallback(callback)}}}
    fun wake(session: String) { if (configuredFor(session)) pollWake.trySend(Unit) }
    private var pollJob: Job? = null
    private var clockJob: Job? = null
    private var operation: Job? = null
    private var recoveryJob: Job? = null
    private var appliedRestart = 0
    private var reportedMedia = -1
    private var pendingAnswer: JSONObject? = null
    private var pendingRestart: JSONObject? = null
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
    private var callSounds:NativeCallSoundPlayer?=null
    private class WarmPeer(val callId:String,@Volatile var version:Int){var job:Deferred<PeerConnection?>?=null}
    private var warmPeer:WarmPeer?=null
    private var audioActivationStarted=false
    private var networkRestartPending=false
    private var rollbackForNetwork=false
    private var networkReady=true
    private var networkSignature=""
    private var networkCallback:android.net.ConnectivityManager.NetworkCallback?=null
    private var networkDebounce:Job?=null
    private var initialized = false
    private val frameObserver = VideoSink { lastVideoFrame = SystemClock.elapsedRealtime() }

    fun configure(appContext: Context, sessionToken: String, trigger:String) {
        debug("configure_requested",JSONObject().put("trigger",trigger).put("session_same",configuredFor(sessionToken)).put("session_blank",sessionToken.isBlank()))
        NativeTelecom.configure(appContext)
        when(nativeCallConfiguration(context!=null,token,sessionToken,state.value.call!=null,NativeCredentials::resolve)) {
            // NativeApi resolves refresh aliases on every request. Keep the live call and its jobs.
            NativeCallConfiguration.KEEP -> { debug("configure_unchanged"); return }
            NativeCallConfiguration.BLOCK -> { debug("configure_blocked"); return }
            NativeCallConfiguration.RESET -> Unit
        }
        end(reason="session_reset")
        pollJob?.cancel()
        clockJob?.cancel()
        toneObserver?.cancel()
        callSounds?.stop()
        context = appContext.applicationContext
        token = sessionToken
        val endOwner=accountId().takeIf{it>0}?:appContext.getSharedPreferences("volna-native",0).getLong("user_id",0)
        endQueue=if(token.isBlank()||endOwner<=0)null else NativeCallEndOutbox(appContext.getSharedPreferences("volna-call-ends",0),BuildConfig.API_BASE_URL.hashCode().toString()+"_"+endOwner)
        val prefs = appContext.getSharedPreferences("volna-native", 0)
        device = prefs.getString("call_device", null)?.takeIf { it.matches(Regex("[a-f0-9]{32}")) }
            ?: UUID.randomUUID().toString().replace("-", "").also { prefs.edit().putString("call_device", it).apply() }
        if (token.isBlank()) {unwatchNetwork();return}
        watchNetwork()
        toneObserver = scope.launch {
            state.map { nativeOutgoingCallTone(it.call?.incoming ?: true,it.call?.status.orEmpty(),it.call?.ringReceived ?: false,it.connected,connectedAt>0) }
                .distinctUntilChanged().collect { tone -> if (tone.isNotEmpty()) startRingback(tone) else stopRingback() }
        }
        clockJob = scope.launch { while (isActive) { updateClock(); delay(1_000) } }
        pollJob = scope.launch {
            var lastSuccess = SystemClock.elapsedRealtime()
            var pollRetryAt=0L
            while (isActive) {
                flushEnds()
                if(SystemClock.elapsedRealtime()<pollRetryAt){withTimeoutOrNull(pollRetryAt-SystemClock.elapsedRealtime()){pollWake.receive()};continue}
                val version = generation
                try {
                    val current = withContext(Dispatchers.IO) { api.currentCall(token, device) }
                    if (version == generation && operation?.isActive != true) {
                        lastSuccess = SystemClock.elapsedRealtime()
                        applyCurrent(current)
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (problem: Exception) {
                    if(problem is NativeApiException&&problem.status==429)pollRetryAt=SystemClock.elapsedRealtime()+nativeCallRetryDelay(problem)
                    if (state.value.call != null) { diagnosticFailure(problem,"poll");debug("poll_error",JSONObject().put("poll_age_ms",SystemClock.elapsedRealtime()-lastSuccess)) }
                    if (version == generation && state.value.call != null && SystemClock.elapsedRealtime() - lastSuccess > 180_000) end("Нет связи с сервером", reason="poll_timeout")
                }
                withTimeoutOrNull(nativeCallPollDelay(state.value.call!=null,state.value.connected,state.value.call?.reconnecting==true)) { pollWake.receive() }
            }
        }
    }

    private suspend fun applyCurrent(current: VolnaCall?) {
        if(current!=null&&endQueue?.has(current.id)==true){flushEnds();return}
        val version = generation
        if (current == null) { if (state.value.call != null) end(reason="server_no_call"); return }
        if (current.status == "other-device") { if (state.value.call != null) end(notifyServer = false, reason="other_device"); return }
        val previous = state.value.call
        val now = SystemClock.elapsedRealtime()
        if (previous?.version != current.version || previous?.id != current.id || now-debugPollAt >= 10000) { debugPollAt=now;debug("poll_snapshot",JSONObject().put("call_version",current.version).put("incoming",current.incoming).put("restart_generation",current.restartGeneration),call=current) }
        val existing = state.value.call
        if (existing == null) {
            if (current.incoming && current.status == "ringing") {
                mutableState.value = NativeCallState(call = current, phase = "Входящий звонок")
                ring(current)
                warmIncoming(current)
                withContext(Dispatchers.IO){api.callAction(token,device,current.id,"ringing")}
            } else {
                // A process restart cannot restore old DTLS keys. Release an abandoned device call.
                val queue=endQueue
                if(queue!=null){queue.add(current.id,device,"abandoned_call");flushEnds(true)}else withContext(Dispatchers.IO){endApi.callAction(token,device,current.id,"end",endReason="abandoned_call")}
            }
            return
        }
        if (existing.id == current.id && current.version < existing.version) return
        if (existing.id != current.id) { end(notifyServer = false, reason="call_replaced"); return }
        if(current.incoming&&current.status=="ringing"&&!current.ringReceived)withContext(Dispatchers.IO){api.callAction(token,device,current.id,"ringing")}
        mutableState.update { if(!current.incoming&&current.status=="ringing")it.copy(call=current,phase=if(current.ringReceived)"У собеседника входящий звонок…" else "Устанавливаем соединение…") else it.copy(call = current) }
        if (cameraWanted && current.status == "active" && state.value.connected && state.value.screenReady) { cameraWanted = false; setCamera(true) }
        val pc = peer
        if (!current.incoming && current.answer != null && pc != null && pc.remoteDescription == null) {
            try { setDescription(pc, current.answer, local = false) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) {
                if (version == generation) { diagnosticFailure(problem);NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось согласовать звонок", reason="answer_error") }
                return
            }
            if (version != generation || peer !== pc) return
            updateScreenReady()
            if (!state.value.connected) NativeCallDiagnostics.step("Установка ответа завершена, ожидание соединения ICE")
            mutableState.update { if (it.connected) it else it.copy(phase = "Соединяем…") }
        }
        if (pc != null) syncRecovery(current, pc)
        if (pc != null && audioTrack != null && !state.value.connected && connectedAt == 0L && SystemClock.elapsedRealtime() - attemptAt > 180_000) end("Не удалось соединиться. Проверьте сеть и TURN", reason="connect_timeout")
    }

    fun start(chat: VolnaChat, video: Boolean = false) {
        if (token.isBlank() || state.value.call != null || operation?.isActive == true) return
        if (chat.kind != "direct" || chat.saved) return
        debug("start_requested")
        val session = token;val ownerDevice=device;val ownerQueue=endQueue
        val version = ++generation
        val clientId=UUID.randomUUID().toString()
        cameraWanted = video
        callSounds?.stop()
        NativeCallDiagnostics.begin()
        mutableState.value = NativeCallState(phase = "Подготовка звонка…", busy = true)
        operation = scope.launch {
            var created: VolnaCall? = null
            try {
                val queue=endQueue
                withTimeoutOrNull(6000){while(queue?.pending()==true){flushEnds();delay(100)}}
                check(queue?.pending()!=true){"Предыдущий звонок завершится после восстановления связи с сервером"}
                diagnosticStep("start");NativeCallDiagnostics.step("Создание звонка на сервере")
                var retryReportedAt=0L
                created=nativeCallNetworkRetry(valid={version==generation},waiting={mutableState.update{it.copy(phase="Нет ответа от сервера. Повторяем запрос…")}},onRetry={problem->
                    val now=SystemClock.elapsedRealtime();if(retryReportedAt==0L||now-retryReportedAt>=5000){retryReportedAt=now;diagnosticFailure(problem,"start");debug("start_retry")}
                }){runInterruptible(Dispatchers.IO){api.startCall(session,ownerDevice,chat.id,video,clientId=clientId)}}
                checkVersion(version)
                val call = created ?: error("Сервер не создал звонок")
                check(call.status in listOf("preparing","ringing")){"Этот вызов уже завершён. Повторите звонок"}
                mutableState.update { it.copy(call = call) }
                val pc = prepare(version)
                val description = createDescription(pc, offer = true)
                setDescription(pc, description, local = true)
                gather(pc)
                checkVersion(version)
                diagnosticStep("offer");NativeCallDiagnostics.step("Передача предложения звонка на сервер")
                val ready = online(version) { api.callAction(session, device, call.id, "offer", localDescription(pc)) }
                checkVersion(version)
                mutableState.update { it.copy(call = ready, phase = "Устанавливаем соединение…", busy = false) }
                NativeCallDiagnostics.step("Ожидание ответа собеседника")
            } catch (cancelled: CancellationException) {
                created?.let { call -> ownerQueue?.add(call.id,ownerDevice,"operation_cancelled");if(ownerQueue!=null)flushEnds(true,ownerQueue,session) else scope.launch(Dispatchers.IO){runCatching{endApi.callAction(session,ownerDevice,call.id,"end",endReason="operation_cancelled")}} }
                throw cancelled
            } catch (problem: Exception) { if (version == generation) { diagnosticFailure(problem);NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось начать звонок", reason=if(problem is NativeApiException&&problem.errorCode=="CALL_BUSY")"call_busy" else "start_error") } }
            catch (problem: LinkageError) { if (version == generation) { diagnosticFailure(problem);NativeCallDiagnostics.failure(problem); end("Не удалось загрузить WebRTC. Откройте диагностику звонка и обновите приложение.", reason="webrtc_unavailable") } }
            finally { if (version == generation) { mutableState.update { it.copy(busy = false) };pollWake.trySend(Unit) } }
        }
    }

    fun accept(video: Boolean = false) {
        val call = state.value.call ?: return
        if (!call.incoming || call.status != "ringing" || operation?.isActive == true) return
        debug("accept_requested")
        val version = ++generation
        warmPeer?.takeIf { it.callId==call.id }?.version=version
        NativeCallDiagnostics.begin()
        stopRinging()
        cameraWanted = video
        mutableState.update { it.copy(phase = "Подключаем микрофон…", busy = true) }
        operation = scope.launch {
            try {
                val accepted = online(version) { api.callAction(token, device, call.id, "accept") }
                checkVersion(version)
                mutableState.update { it.copy(call = accepted) }
                val pc = prepare(version, incoming = true)
                setDescription(pc, accepted?.offer ?: call.offer ?: error("Нет предложения звонка"), local = false)
                // Reuse the transceiver created by the remote offer: both peers send and receive.
                pc.transceivers.filter { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }.forEach { it.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV }
                setDescription(pc, createDescription(pc, offer = false), local = true)
                gather(pc)
                checkVersion(version)
                diagnosticStep("answer");NativeCallDiagnostics.step("Передача ответа звонка на сервер")
                val ready = online(version) { api.callAction(token, device, call.id, "answer", localDescription(pc)) }
                checkVersion(version)
                mutableState.update { it.copy(call = ready, phase = if (it.connected) "Разговор" else "Соединяем…", busy = false) }
                updateScreenReady()
                if (!state.value.connected) NativeCallDiagnostics.step("Ожидание соединения ICE")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { if (version == generation) { if(problem is NativeApiException && problem.errorCode == "CALL_ANSWERED_ELSEWHERE") end(notifyServer = false, reason="other_device") else { diagnosticFailure(problem);NativeCallDiagnostics.failure(problem); end(problem.message ?: "Не удалось принять звонок", reason="accept_error") } } }
            catch (problem: LinkageError) { if (version == generation) { diagnosticFailure(problem);NativeCallDiagnostics.failure(problem); end("Не удалось загрузить WebRTC. Откройте диагностику звонка и обновите приложение.", reason="webrtc_unavailable") } }
            finally { if (version == generation) { mutableState.update { it.copy(busy = false) };pollWake.trySend(Unit) } }
        }
    }

    private fun warmIncoming(call:VolnaCall) {
        if(warmPeer?.callId==call.id)return
        val ticket=WarmPeer(call.id,generation)
        warmPeer=ticket
        ticket.job=scope.async {
            debug("warmup_started")
            try { prepareNetwork(ticket).also { debug("warmup_ready") } }
            catch(cancelled:CancellationException){throw cancelled}
            catch(problem:Exception){if(warmPeer===ticket&&ticket.version==generation){releasePeer();debug("warmup_failed")};null}
            catch(problem:LinkageError){if(warmPeer===ticket&&ticket.version==generation){releasePeer();debug("warmup_failed")};null}
        }
    }

    private suspend fun prepare(version:Int,incoming:Boolean=false):PeerConnection {
        val app=context?:error("Приложение не запущено")
        val id=state.value.call?.id?:throw CancellationException("Звонок отменён")
        val warmed=warmPeer?.takeIf { it.callId==id }
        warmed?.version=version
        val prepared=warmed?.job?.await()
        checkVersion(version)
        audioActivationStarted=true
        val pc=prepared?:run { val ticket=WarmPeer(id,version);warmPeer=ticket;prepareNetwork(ticket) }
        checkVersion(version)
        diagnosticStep("microphone");NativeCallDiagnostics.step("Запуск сервиса микрофона")
        CallService.ensureReady(app)
        checkVersion(version)
        diagnosticStep("audio_device");NativeCallDiagnostics.step("Получение аудиофокуса")
        beginAudio(app)
        val mediaFactory=factory?:error("Фабрика звонка освобождена")
        NativeCallDiagnostics.step("Создание дорожки микрофона")
        val source = mediaFactory.createAudioSource(MediaConstraints().apply {
            optional.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            optional.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
        })
        audioSource = source
        val track = mediaFactory.createAudioTrack("volna-audio", source)
        audioTrack = track
        val audioSender = checkNotNull(pc.addTrack(track, listOf("volna"))) { "Не удалось подключить микрофон к звонку" }
        val audioParameters = audioSender.parameters
        audioParameters.encodings.forEach { it.maxBitrateBps = 24_000 }
        audioSender.setParameters(audioParameters)
        NativeCallDiagnostics.step("Добавление канала демонстрации экрана")
        if (!incoming) checkNotNull(pc.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_RECV, listOf("volna")))) { "Не удалось подготовить видеоканал" }
        attemptAt = SystemClock.elapsedRealtime()
        diagnosticJob?.cancel()
        val audioMonitor=NativeCallAudioMonitor(SystemClock.elapsedRealtime());var statsAt=0L
        diagnosticJob=scope.launch { while(version==generation&&peer===pc) { runCatching { pc.getStats { report -> scope.launch stats@{
            if(version!=generation||peer!==pc)return@stats
            val summary=nativeCallStats(report.statsMap.values.map { NativeCallStat(it.id,it.type,it.members) });val now=SystemClock.elapsedRealtime()
            val audio=audioMonitor.observe(if(summary.has("audio_packets_received"))summary.optLong("audio_packets_received") else null,now)
            if(audio!=null)diagnostic("client.lifecycle",JSONObject().put("lifecycle",audio.first).apply{audio.second?.let{put("elapsed_ms",it)}})
            if(now-statsAt>=5000){statsAt=now;diagnostic("rtc.stats",summary)}
        } } };delay(if(audioMonitor.received)5000 else 1000) } }
        return pc
    }

    private suspend fun prepareNetwork(ticket:WarmPeer): PeerConnection {
        val app = context ?: error("Приложение не запущено")
        // NetworkMonitor queries ConnectivityManager from JNI during ICE. An uncaught
        // SecurityException there aborts the native network thread instead of reaching Kotlin.
        NativeCallDiagnostics.step("Проверка разрешений сети")
        check(app.checkSelfPermission(Manifest.permission.ACCESS_NETWORK_STATE) == PackageManager.PERMISSION_GRANTED) {
            "В установленной сборке отсутствует разрешение ACCESS_NETWORK_STATE. Обновите приложение VLN."
        }
        diagnosticStep("turn_config");NativeCallDiagnostics.step("Получение настроек ICE/TURN")
        val config = online({ticket.version}) { api.callConfig(token, ticket.callId) }
        check(config.optBoolean("relayConfigured") && (config.optJSONArray("iceServers")?.length() ?: 0) > 0) { "Звонки доступны только через TURN. Сервер TURN не настроен." }
        checkVersion(ticket.version)
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
                override fun onWebRtcAudioRecordInitError(message: String) = mediaFailure(ticket.version, "Не удалось открыть микрофон", message)
                override fun onWebRtcAudioRecordStartError(code: JavaAudioDeviceModule.AudioRecordStartErrorCode, message: String) = mediaFailure(ticket.version, "Не удалось включить микрофон", message)
                override fun onWebRtcAudioRecordError(message: String) = mediaFailure(ticket.version, "Микрофон недоступен", message)
            })
            .setAudioTrackErrorCallback(object : JavaAudioDeviceModule.AudioTrackErrorCallback {
                override fun onWebRtcAudioTrackInitError(message: String) = mediaFailure(ticket.version, "Не удалось открыть динамик", message)
                override fun onWebRtcAudioTrackStartError(code: JavaAudioDeviceModule.AudioTrackStartErrorCode, message: String) = mediaFailure(ticket.version, "Не удалось включить динамик", message)
                override fun onWebRtcAudioTrackError(message: String) = mediaFailure(ticket.version, "Динамик недоступен", message)
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
        val rtc = nativeCallRtcConfig(iceServers,incoming=state.value.call?.incoming==true)
        diagnosticStep("peer_create");NativeCallDiagnostics.step("Создание соединения WebRTC")
        val pc = mediaFactory.createPeerConnection(rtc, observer({ ticket.version }) { warmPeer===ticket }) ?: error("Не удалось создать WebRTC")
        peer = pc
        diagnostic("rtc.state",JSONObject().put("bundle_policy","max-bundle").put("candidate_pool_size",rtc.iceCandidatePoolSize))
        attemptAt=SystemClock.elapsedRealtime()
        mutableState.update { it.copy(relay=config.optBoolean("relayConfigured")) }
        return pc
    }

    private fun mediaFailure(version: Int, label: String, detail: String) {
        scope.launch {
            if (version != generation||!audioActivationStarted) return@launch
            diagnosticStep("audio_device");diagnosticFailure(IllegalStateException(label));NativeCallDiagnostics.failure(IllegalStateException(detail))
            end("$label. Проверьте разрешения и закройте другие приложения, использующие звук.", reason="audio_error")
        }
    }

    private fun observer(version: ()->Int,current:()->Boolean) = object : PeerConnection.Observer {
        override fun onSignalingChange(value: PeerConnection.SignalingState?) { if(version()==generation&&current())diagnostic("rtc.state",JSONObject().put("signaling",value?.name?.lowercase()?.replace('_','-'))) }
        override fun onIceConnectionChange(value: PeerConnection.IceConnectionState?) { if(version()==generation&&current())diagnostic("rtc.state",JSONObject().put("ice",value?.name?.lowercase())) }
        override fun onIceConnectionReceivingChange(value: Boolean) { }
        override fun onIceGatheringChange(value: PeerConnection.IceGatheringState?) { if(version()==generation&&current())diagnostic("rtc.state",JSONObject().put("gathering",value?.name?.lowercase())) }
        override fun onIceCandidateError(event: IceCandidateErrorEvent?) { if(version()==generation&&current()&&event!=null)diagnostic("rtc.ice_error",JSONObject().put("ice_error",event.errorCode)) }
        override fun onIceCandidate(value: IceCandidate?) { if(version()==generation&&current()&&value!=null)diagnostic("rtc.candidate",nativeIceCandidateEvent(value.sdp)) }
        override fun onIceCandidatesRemoved(values: Array<out IceCandidate>?) { }
        override fun onAddStream(value: MediaStream?) { }
        override fun onRemoveStream(value: MediaStream?) { }
        override fun onDataChannel(value: DataChannel?) { }
        override fun onRenegotiationNeeded() { }
        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) { receiveTrack(receiver?.track(), version()) }
        override fun onTrack(transceiver: RtpTransceiver?) { receiveTrack(transceiver?.receiver?.track(), version()) }
        override fun onConnectionChange(value: PeerConnection.PeerConnectionState?) {
            scope.launch {
                if (version() != generation||!current()) return@launch
                diagnostic("rtc.state",JSONObject().put("connection",value?.name?.lowercase()))
                if(audioTrack==null)return@launch
                when (value) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        disconnectedAt = 0L
                        if (connectedAt == 0L) connectedAt = SystemClock.elapsedRealtime()
                        mutableState.update { it.copy(connected = true, phase = "Разговор") }
                        state.value.call?.let { peer?.let { pc -> syncRecovery(it, pc) } }
                        NativeCallDiagnostics.step("Звонок соединён")
                        updateScreenReady()
                        if (cameraWanted && state.value.call?.status == "active") { cameraWanted = false; setCamera(true) }
                    }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> requestRecovery()
                    PeerConnection.PeerConnectionState.FAILED -> requestRecovery()
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
    fun previewCamera(front: Boolean = true) {
        if (state.value.cameraPreview) { if (state.value.cameraFront != front) switchCamera(); return }
        setCamera(true, preview = true, front = front)
    }
    fun cancelCameraPreview() { if (state.value.cameraPreview) stopCamera() }
    fun publishCameraPreview() {
        if (!state.value.cameraPreview || !state.value.connected || state.value.call?.status != "active") return
        val sender = videoSender() ?: return
        val track = cameraTrack ?: return
        if (!sender.setTrack(track, false)) { mutableState.update { it.copy(error = "Не удалось включить трансляцию") }; return }
        mutableState.update { it.copy(cameraPreview = false, cameraEnabled = true) }; signalCamera(true)
    }
    fun setCamera(enabled: Boolean, preview: Boolean = false, front: Boolean = true) {
        if (!enabled) { stopCamera(); return }
        if (state.value.cameraEnabled || state.value.cameraPreview || !state.value.connected || !state.value.screenReady) return
        try {
            val app = context ?: error("Звонок завершён")
            check(app.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { "Разрешите доступ к камере" }
            if (state.value.sharing) stopScreenSharing()
            CallService.cameraStarted()
            val mediaFactory = factory ?: error("Звонок завершён")
            val enumerator = Camera2Enumerator(app)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) == front } ?: enumerator.deviceNames.firstOrNull() ?: error("Камера не найдена")
            val capture = enumerator.createCapturer(name, null) ?: error("Камера недоступна")
            cameraCapturer = capture
            val source = mediaFactory.createVideoSource(false).also { cameraSource = it }
            val helper = SurfaceTextureHelper.create("volna-camera", eglContext ?: error("Видеоустройство недоступно")) ?: error("Камера недоступна")
            cameraTexture = helper
            capture.initialize(helper, app, source.capturerObserver)
            source.adaptOutputFormat(640, 480, 24); capture.startCapture(640, 480, 24)
            val track = mediaFactory.createVideoTrack("volna-camera", source).also { cameraTrack = it }
            val sender = videoSender() ?: error("Видеоканал недоступен")
            if (!preview) check(sender.setTrack(track, false)) { "Не удалось включить камеру" }
            localVideoSinks.forEach(track::addSink)
            val parameters = sender.parameters
            parameters.encodings.forEach { it.maxBitrateBps = 400_000; it.maxFramerate = 15 }; sender.setParameters(parameters)
            mutableState.update { it.copy(cameraEnabled = !preview, cameraPreview = preview, cameraFront = enumerator.isFrontFacing(name), error = "") }
            if (!preview) signalCamera(true)
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
        mutableState.update { it.copy(cameraEnabled = false, cameraPreview = false) }; CallService.cameraStopped()
        if (enabled) signalCamera(false)
    }
    private fun signalCamera(enabled: Boolean) {
        val call = state.value.call ?: return
        val session = token; val version = generation
        scope.launch {
            repeat(3) {
                if (version != generation || state.value.call?.id != call.id) return@launch
                try { withContext(Dispatchers.IO) { api.callCamera(session, device, call.id, enabled) }; return@launch }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { delay(1_000) }
            }
            if (enabled && version == generation && state.value.cameraEnabled) { stopCamera(); mutableState.update { it.copy(error = "Сервер не подтвердил видео. Звук продолжает работать; попробуйте включить камеру ещё раз.") } }
        }
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
            catch (problem: Exception) { if (sharing && version == generation && state.value.sharing) { stopScreenSharing(); mutableState.update { it.copy(error = "Сервер не подтвердил демонстрацию. Обновите VLN и попробуйте ещё раз.") } } }
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

    fun audioRouteChanged(label:String){mutableState.update{it.copy(route=label,routePending=false)}}
    fun audioRouteFailed(message:String){mutableState.update{it.copy(error=message,routePending=false)}}
    fun routes(): List<NativeAudioRoute> {
        NativeTelecom.routes()?.let{return it}
        val manager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return emptyList()
        if (Build.VERSION.SDK_INT >= 31) return runCatching { manager.availableCommunicationDevices.map { NativeAudioRoute(it.id, routeName(it)) } }.getOrDefault(emptyList())
        return listOf(NativeAudioRoute(-1, "Телефон / гарнитура"), NativeAudioRoute(-2, "Динамик"))
    }
    fun selectRoute(id: Int) {
        val manager = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        try {
            mutableState.update{it.copy(routePending=true,error="")}
            val callId=state.value.call?.id
            scope.launch{delay(5_000);if(state.value.call?.id==callId&&state.value.routePending)audioRouteFailed("Android не подтвердил переключение звука. Повторите выбор устройства.")}
            if(NativeTelecom.selectRoute(id))return
            if (Build.VERSION.SDK_INT >= 31) {
                val route = manager.availableCommunicationDevices.firstOrNull { it.id == id } ?: error("Устройство отключено")
                if (!manager.setCommunicationDevice(route)) error("Не удалось переключить аудиовыход")
                mutableState.update { it.copy(route = routeName(route),routePending=false) }
            } else { manager.isSpeakerphoneOn = id == -2; mutableState.update { it.copy(route = if (id == -2) "Динамик" else "Телефон / гарнитура",routePending=false) } }
        } catch (problem: Exception) { mutableState.update { it.copy(error = problem.message ?: "Не удалось выбрать динамик",routePending=false) } }
    }
    private fun routeName(device: AudioDeviceInfo): String = when (device.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Динамик"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Телефон"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Гарнитура"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "USB-гарнитура"
        else -> "Аудиоустройство"
    }
    private suspend fun beginAudio(app: Context) {
        val version = generation
        val manager = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val callId = state.value.call?.id ?: throw CancellationException("Звонок отменён")
        NativeCallDiagnostics.step("Ожидание системного аудиофокуса Telecom")
        debug("audio_focus_requested")
        if (NativeTelecom.audioFocus(callId)) {
            checkVersion(version)
            telecomAudio = true
            return
        }
        checkVersion(version)
        NativeCallDiagnostics.step("Получение аудиофокуса приложения")
        val granted = CompletableDeferred<Boolean>()
        originalMode = manager.mode; originalSpeaker = manager.isSpeakerphoneOn
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAcceptsDelayedFocusGain(true)
            .setOnAudioFocusChangeListener { value -> scope.launch {
                if (version != generation) return@launch
                diagnostic("rtc.state",JSONObject().put("stage","audio_device").put("audio_focus",when(value){AudioManager.AUDIOFOCUS_GAIN->"gained";AudioManager.AUDIOFOCUS_LOSS->"lost";else->"transient"}))
                when (value) {
                    AudioManager.AUDIOFOCUS_LOSS -> { granted.complete(false); end("Звук занят другим звонком", reason="audio_focus_lost") }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { audioTrack?.setEnabled(false); mutableState.update { it.copy(phase = "Звук временно занят") } }
                    AudioManager.AUDIOFOCUS_GAIN -> { granted.complete(true); audioTrack?.setEnabled(!state.value.muted); if (state.value.connected) mutableState.update { it.copy(phase = "Разговор") } }
                }
            } }.build()
        focus = request
        val result = manager.requestAudioFocus(request)
        val ready = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED || result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED && withTimeoutOrNull(8_000) { granted.await() } == true
        checkVersion(version)
        check(ready) { "Android не разрешил доступ к звуку. Завершите другой звонок и повторите вызов." }
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) mutableState.update { it.copy(route = runCatching { manager.communicationDevice?.let(::routeName) }.getOrNull() ?: "Телефон") }
    }

    private var telecomAudio = false
    internal fun systemAudioLost() { if (telecomAudio && state.value.call != null) end("Звук передан другому системному звонку", reason="telecom_audio_lost") }

    fun end(message: String = "", notifyServer: Boolean = true, reason: String) {
        val call = state.value.call; val session = token;val queue=endQueue;val endDevice=device
        if(notifyServer&&call!=null&&session.isNotBlank())queue?.add(call.id,device,reason)
        if (call != null) diagnostic("client.ended",JSONObject().put("stage",diagnosticStage).put("connected",state.value.connected).put("end_reason",reason).put("notify_server",notifyServer).put("call_status",call.status).put("has_peer",peer!=null).put("operation_active",operation?.isActive==true).put("telecom_audio",telecomAudio));diagnosticJob?.cancel();diagnosticJob=null
        generation++
        warmPeer?.job?.cancel();warmPeer=null
        audioActivationStarted=false;networkRestartPending=false;rollbackForNetwork=false;recoveryErrorAt=0L
        operation?.cancel(); operation = null
        recoveryJob?.cancel(); recoveryJob = null; pendingRestart = null; pendingAnswer = null; appliedRestart = 0; reportedMedia = -1
        stopRinging()
        cameraWanted = false
        stopCamera()
        stopScreenSharing()
        remoteTrack?.let { track -> runCatching { track.removeSink(frameObserver); videoSinks.forEach(track::removeSink) } }; remoteTrack = null
        releasePeer()
        (context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.let { manager ->
            if ((focus != null || telecomAudio) && Build.VERSION.SDK_INT >= 31) runCatching { manager.clearCommunicationDevice() }
            focus?.let { request ->
                runCatching { manager.abandonAudioFocusRequest(request) }
                runCatching { manager.isSpeakerphoneOn = originalSpeaker }
                runCatching { manager.mode = originalMode }
            }
        }
        focus = null; telecomAudio = false; connectedAt = 0L; disconnectedAt = 0L; lastVideoFrame = 0L
        mutableState.value = NativeCallState(error = message)
        NativeCallDiagnostics.finish(message)
        context?.let { runCatching { CallService.stop(it) } }
        val finishTone=nativeCallEndTone(reason,call!=null)
        if(finishTone.isNotEmpty())soundPlayer()?.effect(finishTone)
        if (notifyServer && call != null && session.isNotBlank()){if(queue!=null)flushEnds(true,queue,session) else scope.launch(Dispatchers.IO){runCatching{endApi.callAction(session,endDevice,call.id,"end",endReason=reason)}}}
    }

    private fun releasePeer() {
        NativeCallDiagnostics.step("Освобождение соединения WebRTC")
        runCatching { peer?.close() }; runCatching { peer?.dispose() }; peer = null
        val track = audioTrack; audioTrack = null; runCatching { track?.dispose() }
        val source = audioSource; audioSource = null; runCatching { source?.dispose() }
        NativeCallDiagnostics.step("Освобождение фабрики WebRTC")
        val oldFactory = factory; factory = null; runCatching { oldFactory?.dispose() }
        NativeCallDiagnostics.step("Освобождение аудиоустройства")
        val module = audioModule; audioModule = null; runCatching { module?.release() }
    }

    private fun updateProtocolCall(call: VolnaCall) {
        mutableState.update { if (it.call?.id == call.id && call.version >= (it.call?.version ?: 0)) it.copy(call = call) else it }
        // An SSE wake may already have been consumed while this mutation was in flight.
        // Continue negotiation immediately after the reply, instead of waiting for a poll timeout.
        if(state.value.call?.id==call.id)pollWake.trySend(Unit)
    }

    private fun requestRecovery() {
        if (disconnectedAt == 0L) disconnectedAt = SystemClock.elapsedRealtime()
        reportedMedia = -1
        mutableState.update { it.copy(connected = false, phase = "Восстанавливаем соединение…") }
        val call = state.value.call ?: return
        if (!call.mediaReporting || recoveryJob?.isActive == true) return
        val version=generation
        val network=networkRestartPending
        recoveryJob=scope.launch { try {
            val updated=online(version){api.callProtocol(token,device,call.id,"ice-restart",JSONObject().apply{if(network)put("network_change",true)})}
            checkVersion(version);if(network)networkRestartPending=false;updateProtocolCall(updated)
        }catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){recoveryFailure(problem,call.restartGeneration)} }

    }

    private fun syncRecovery(call: VolnaCall, pc: PeerConnection) {
        if (!call.mediaReporting || call.status != "active" || recoveryJob?.isActive == true) return
        if(networkRestartPending&&networkReady){requestRecovery();return}
        val version=generation
        recoveryJob=scope.launch {
            try {
                val epoch=call.restartGeneration
                if(disconnectedAt>0&&!call.reconnecting){val updated=online(version){api.callProtocol(token,device,call.id,"ice-restart",JSONObject())};checkVersion(version);updateProtocolCall(updated);return@launch}
                if(call.restartRequested&&!call.incoming&&rollbackForNetwork){
                    if(pc.signalingState()==PeerConnection.SignalingState.HAVE_LOCAL_OFFER)setDescription(pc,JSONObject().put("type","rollback").put("sdp",""),true)
                    pendingRestart=null;rollbackForNetwork=false
                }
                if(call.restartRequested&&!call.incoming&&pendingRestart==null&&pc.signalingState()==PeerConnection.SignalingState.STABLE){
                    setDescription(pc,createDescription(pc,true,restart=true),true);gather(pc);checkVersion(version)
                    pendingRestart=JSONObject().put("description",localDescription(pc)).put("restart_generation",epoch)
                }
                val pending=pendingRestart
                if(pending!=null){
                    if(epoch==pending.getInt("restart_generation")){val updated=online(version){api.callProtocol(token,device,call.id,"ice-restart",pending)};checkVersion(version);updateProtocolCall(updated);return@launch}
                    pendingRestart=null
                }
                if(epoch>appliedRestart){
                    if(call.incoming&&call.offer!=null){if(pendingAnswer?.optInt("restart_generation",-1)!=epoch){setDescription(pc,call.offer,false);setDescription(pc,createDescription(pc,false),true);gather(pc);checkVersion(version);pendingAnswer=JSONObject().put("description",localDescription(pc)).put("restart_generation",epoch)};val response=pendingAnswer?:return@launch;val updated=online(version){api.callProtocol(token,device,call.id,"answer",response)};checkVersion(version);updateProtocolCall(updated);appliedRestart=epoch;pendingAnswer=null}
                    else if(!call.incoming&&call.answer!=null){setDescription(pc,call.answer,false);checkVersion(version);appliedRestart=epoch}
                    else return@launch
                }
                if(peer!==pc||version!=generation)return@launch
                if(pc.connectionState()==PeerConnection.PeerConnectionState.CONNECTED&&appliedRestart==epoch&&!call.restartRequested){
                    disconnectedAt=0L
                    mutableState.update{it.copy(connected=true,phase="Разговор")}
                }
                if(state.value.connected&&reportedMedia!=epoch){val updated=online(version){api.callProtocol(token,device,call.id,"media-state",JSONObject().put("connected",true).put("restart_generation",epoch))};checkVersion(version);updateProtocolCall(updated);reportedMedia=epoch}
                val code=nativeCallSafetyCode(call.id,pc.localDescription?.description,pc.remoteDescription?.description)
                mutableState.update{it.copy(safetyCode=code)}
            } catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){recoveryFailure(problem,call.restartGeneration)/* Polling retries signaling until the recovery lease expires. */}
        }
    }

    private fun updateClock() {
        val now = SystemClock.elapsedRealtime()
        if (disconnectedAt > 0 && now - disconnectedAt > 180_000) { end("Соединение звонка потеряно", reason="recovery_timeout"); return }
        mutableState.update { it.copy(elapsed = if (connectedAt > 0) ((now - connectedAt) / 1000).toInt() else 0,
            remoteSharing = it.call?.peerSharing ?: (lastVideoFrame > 0 && now - lastVideoFrame < 4_000),
            remoteVideo = it.call?.peerVideo == true || it.call?.peerSharing != true && lastVideoFrame > 0 && now - lastVideoFrame < 4_000) }
        if (state.value.call != null) CallService.refresh()
    }
    private fun checkVersion(version: Int) { if (version != generation) throw CancellationException("Звонок отменён") }
    private suspend fun gather(pc: PeerConnection) {
        val gatherStarted=SystemClock.elapsedRealtime()
        diagnosticStep("gather");NativeCallDiagnostics.step("Сбор сетевых кандидатов ICE")
        var lastCount=0
        var changed=gatherStarted
        while(peer===pc){
            val now=SystemClock.elapsedRealtime()
            val summary=nativeCandidateSummary(pc.localDescription?.description.orEmpty())
            val count=summary.optInt("relay_count")
            if(count!=lastCount){lastCount=count;changed=now}
            val reason=nativeRelayGatherDecision(pc.iceGatheringState()==PeerConnection.IceGatheringState.COMPLETE,count,now-changed,now-gatherStarted)
            if(reason!=null){diagnostic("rtc.gathered",summary.put("elapsed_ms",now-gatherStarted).put("gather_exit",reason));return}
            delay(40)
        }
    }
    private fun localDescription(pc: PeerConnection): JSONObject = pc.localDescription.let { JSONObject().put("type", it.type.canonicalForm()).put("sdp", it.description) }
    private suspend fun createDescription(pc: PeerConnection, offer: Boolean, restart: Boolean = false): JSONObject {
        val type = if (offer) "offer" else "answer"
        NativeCallDiagnostics.step("Создание локального SDP $type")
        check(peer === pc) { "Звонок завершён" }
        return withTimeoutOrNull(15_000) {
            suspendCancellableCoroutine<JSONObject> { result ->
                val observer = object : SdpObserver {
                    override fun onCreateSuccess(description: SessionDescription?) { if (result.isActive) { if (description == null) result.resumeWithException(IllegalStateException("Нет SDP")) else result.resume(JSONObject().put("type", description.type.canonicalForm()).put("sdp", economicalAudioSdp(description.description))) } }
                    override fun onCreateFailure(message: String?) { if (result.isActive) result.resumeWithException(IllegalStateException(message ?: "Не удалось подготовить звонок")) }
                    override fun onSetSuccess() { }
                    override fun onSetFailure(message: String?) { }
                }
                val constraints=MediaConstraints().apply { if(restart)mandatory.add(MediaConstraints.KeyValuePair("IceRestart","true")) };if (offer) pc.createOffer(observer, constraints) else pc.createAnswer(observer, constraints)
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
        runCatching { CallAlerts.show(app, call, accountId(), NativeAccounts.list(app).firstOrNull{it.user.id==accountId()}?.user?.name.orEmpty()) }
        if (!NativePriorityCalls.enabled(app, accountId(), call.peer?.id ?: 0)) NativeCallVibration.start(app)
        val uri = NativeNotificationSounds.callUri(app)
        ringtone = NativePriorityCalls.play(app, accountId(), call, foreground = true) ?: if (NativeNotificationSounds.callSoundAllowed(app) && uri != null) runCatching { RingtoneManager.getRingtone(app, uri) }.getOrNull()?.also {
            if (Build.VERSION.SDK_INT >= 28) it.isLooping = true
            runCatching { it.play() }
        } else null
    }
    private fun stopRinging() {
        NativeCallVibration.stop()
        NativePriorityCalls.stop(accountId(), foreground = true)
        stopRingback()
        val old = ringtone; ringtone = null; runCatching { old?.stop() }
        runCatching { context?.getSystemService(NotificationManager::class.java)?.cancel(CALL_NOTIFICATION) }
    }
    private fun soundPlayer():NativeCallSoundPlayer? { val app=context?:return null;return callSounds?:NativeCallSoundPlayer(app).also{callSounds=it} }
    private fun startRingback(kind:String){soundPlayer()?.loop(kind)}
    private fun stopRingback(){callSounds?.stopLoop()}

    const val CALL_CHANNEL = "volna_incoming_calls"
    const val CALL_NOTIFICATION = 11031
}
