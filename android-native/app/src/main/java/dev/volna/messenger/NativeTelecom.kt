package dev.volna.messenger

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.telecom.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect

/** Self-managed VoIP calls: hardware policy remains entirely with Android/OEM. */
internal object NativeTelecom {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var app: Context? = null
    private var account: PhoneAccountHandle? = null
    private var announced: String? = null
    private var connection: VolnaConnection? = null
    private var systemFocused = false
    private var failed: String? = null

    fun configure(context: Context) {
        if (app != null) return
        app = context.applicationContext
        val handle = PhoneAccountHandle(ComponentName(context, VolnaConnectionService::class.java), "volna-voip")
        try {
            val telecom = context.getSystemService(TelecomManager::class.java) ?: return
            telecom.registerPhoneAccount(PhoneAccount.builder(handle, "VLN")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED or PhoneAccount.CAPABILITY_VIDEO_CALLING)
                .setSupportedUriSchemes(listOf("volna", "tel", "sip")).build())
            account = handle
        } catch (_: RuntimeException) { /* Calls continue through the existing app UI. */ }
        scope.launch { NativeCalls.state.collect { sync(it) } }
    }

    private fun sync(state: NativeCallState) {
        val call = state.call
        if (call == null || call.id != announced) {
            runCatching { connection?.finish() }; connection = null
            announced = null; systemFocused = false; failed = null
        }
        if (call == null) return
        if (announced == null) {
            val context = app ?: return
            val handle = account ?: return
            announced = call.id; failed = null
            try {
                val extras = Bundle().apply { putString(CALL_ID, call.id);callerAddress(call)?.let{putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,it)} }
                val telecom = context.getSystemService(TelecomManager::class.java)
                if (call.incoming) telecom.addNewIncomingCall(handle, extras)
                else telecom.placeCall(Uri.fromParts("volna", call.id, null), Bundle().apply {
                    putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
                    putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, extras)
                })
            } catch (_: RuntimeException) { failed = call.id }
        }
        runCatching { connection?.update(state) }
    }

    /** Telecom owns audio focus for a self-managed call; do not request it a second time. */
    suspend fun audioFocus(id: String): Boolean {
        if (!nativeTelecomUsesSystemFocus(Build.VERSION.SDK_INT, account != null, announced, id)) return false
        val available = withTimeoutOrNull(8_000) {
            while (NativeCalls.state.value.call?.id == id && announced == id && failed != id) {
                if (connection != null && systemFocused) return@withTimeoutOrNull true
                delay(40)
            }
            false
        }
        if (available == true) return true
        if (NativeCalls.state.value.call?.id != id) throw CancellationException("Звонок отменён")
        if (failed == id || connection == null) {
            // A late Connection must not seize audio after the manual fallback starts.
            failed = id; systemFocused = false
            return false
        }
        error("Android не передал звук системному звонку. Завершите другой звонок и повторите вызов.")
    }
    fun focusChanged(gained: Boolean) {
        systemFocused = gained
        if (!gained) NativeCalls.systemAudioLost()
    }
    fun creationFailed(id: String?) { if (id == announced) failed = id }

    fun create(id: String?): Connection {
        val state = NativeCalls.state.value
        val call = state.call
        if (id == null || call == null || id != call.id || id != announced || failed == id)
            return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        return VolnaConnection(id).also { created ->
            connection?.finish(); connection = created
            created.setAddress(callerAddress(call),TelecomManager.PRESENTATION_ALLOWED)
            created.setCallerDisplayName(callerName(call), TelecomManager.PRESENTATION_ALLOWED)
            created.update(state)
        }
    }

    fun callerName(call:VolnaCall):String = app?.let{nativeContactCallerName(it,NativeCalls.accountId(),call.peer)}?:nativeCallerName("","",call.peer?.name.orEmpty())
    fun callerAddress(call:VolnaCall):Uri? = app?.let{nativeContactCallerPhone(it,NativeCalls.accountId(),call.peer)}?.let{Uri.fromParts("tel",it,null)}
    fun routes():List<NativeAudioRoute>? = if(systemFocused)connection?.routes() else null
    fun selectRoute(id:Int):Boolean {
        if(!systemFocused)return false
        val current=connection?:return false
        current.selectRoute(id);return true
    }
    fun answer(id: String, video: Boolean) {
        val context = app ?: return
        val call = NativeCalls.state.value.call ?: return
        if (!nativeTelecomActionAllowed(NativeCalls.state.value, id, incomingOnly = true)) return
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            NativeCalls.accept(video = video && call.video && context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        } else {
            // The normal activity requests microphone permission; no background recording.
            runCatching { IncomingCallActivity.pending(context, id, answer = true, account=NativeCalls.accountId()).send() }
        }
    }

    fun end(id: String) { if (nativeTelecomActionAllowed(NativeCalls.state.value, id)) NativeCalls.end() }
    fun mute(id: String, muted: Boolean) {
        if (NativeCalls.state.value.call?.id == id && NativeCalls.state.value.muted != muted) NativeCalls.toggleMute()
    }
    const val CALL_ID = "dev.volna.messenger.TELECOM_CALL_ID"
}

internal class VolnaConnection(private val id: String) : Connection() {
    private var lastSystemMuted: Boolean? = null
    private var audioState:CallAudioState?=null
    private var endpoints:List<CallEndpoint> = emptyList()
    fun routes():List<NativeAudioRoute> {
        if(Build.VERSION.SDK_INT>=34 && endpoints.isNotEmpty())return endpoints.map{NativeAudioRoute(it.identifier.hashCode() or Int.MIN_VALUE,endpointLabel(it))}
        val mask=audioState?.supportedRouteMask?: (CallAudioState.ROUTE_EARPIECE or CallAudioState.ROUTE_SPEAKER)
        return listOf(-1 to CallAudioState.ROUTE_EARPIECE,-2 to CallAudioState.ROUTE_SPEAKER,-3 to CallAudioState.ROUTE_BLUETOOTH,-4 to CallAudioState.ROUTE_WIRED_HEADSET).filter{mask and it.second!=0}.map{NativeAudioRoute(it.first,legacyLabel(it.second))}
    }
    fun selectRoute(route:Int) {
        if(Build.VERSION.SDK_INT>=34 && endpoints.isNotEmpty()) {
            val target=endpoints.firstOrNull{(it.identifier.hashCode() or Int.MIN_VALUE)==route}?:error("Устройство отключено")
            requestCallEndpointChange(target,java.util.concurrent.Executor{it.run()},object:android.os.OutcomeReceiver<Void,CallEndpointException>{
                @androidx.annotation.RequiresApi(34)
                override fun onResult(result:Void?){if(NativeCalls.state.value.call?.id==id)NativeCalls.audioRouteChanged(endpointLabel(target))}
                override fun onError(error:CallEndpointException){if(NativeCalls.state.value.call?.id==id)NativeCalls.audioRouteFailed(error.message?:"Не удалось переключить звук")}
            })
        }else setAudioRoute(when(route){-2->CallAudioState.ROUTE_SPEAKER;-3->CallAudioState.ROUTE_BLUETOOTH;-4->CallAudioState.ROUTE_WIRED_HEADSET;else->CallAudioState.ROUTE_EARPIECE})
    }
    private fun legacyLabel(route:Int)=when(route){CallAudioState.ROUTE_SPEAKER->"Динамик";CallAudioState.ROUTE_BLUETOOTH->"Bluetooth";CallAudioState.ROUTE_WIRED_HEADSET->"Гарнитура";else->"Телефон"}
    @androidx.annotation.RequiresApi(34)
    private fun endpointLabel(endpoint:CallEndpoint)=when(endpoint.endpointType){CallEndpoint.TYPE_SPEAKER->"Динамик";CallEndpoint.TYPE_BLUETOOTH->"Bluetooth · ${endpoint.endpointName}";CallEndpoint.TYPE_WIRED_HEADSET->"Гарнитура";CallEndpoint.TYPE_EARPIECE->"Телефон";else->endpoint.endpointName.toString()}
    @androidx.annotation.RequiresApi(34)
    override fun onAvailableCallEndpointsChanged(availableEndpoints:MutableList<CallEndpoint>){endpoints=availableEndpoints.toList()}
    @androidx.annotation.RequiresApi(34)
    override fun onCallEndpointChanged(callEndpoint:CallEndpoint){if(NativeCalls.state.value.call?.id==id)NativeCalls.audioRouteChanged(endpointLabel(callEndpoint))}

    init {
        connectionProperties = PROPERTY_SELF_MANAGED
        audioModeIsVoip = true
        connectionCapabilities = CAPABILITY_MUTE or CAPABILITY_SUPPORTS_VT_LOCAL_BIDIRECTIONAL or CAPABILITY_SUPPORTS_VT_REMOTE_BIDIRECTIONAL
    }
    fun update(state: NativeCallState) {
        if (state.call?.id != id) { finish(); return }
        val contactAddress=NativeTelecom.callerAddress(state.call)
        if(address!=contactAddress)setAddress(contactAddress,TelecomManager.PRESENTATION_ALLOWED)
        val callerName=NativeTelecom.callerName(state.call)
        if(callerDisplayName!=callerName)setCallerDisplayName(callerName,TelecomManager.PRESENTATION_ALLOWED)
        when {
            nativeTelecomShouldActivate(state) -> if (this.state != STATE_ACTIVE) setActive()
            state.call.incoming && state.call.status == "ringing" -> if (this.state != STATE_RINGING) setRinging()
            else -> if (this.state != STATE_DIALING) setDialing()
        }
        setVideoState(if (state.call.video || state.cameraEnabled || state.remoteVideo) android.telecom.VideoProfile.STATE_BIDIRECTIONAL else android.telecom.VideoProfile.STATE_AUDIO_ONLY)
    }
    fun finish() { setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy() }
    override fun onAnswer() = NativeTelecom.answer(id, NativeCalls.state.value.call?.video == true)
    override fun onAnswer(videoState: Int) = NativeTelecom.answer(id, VideoProfile.isVideo(videoState))
    override fun onDisconnect() = NativeTelecom.end(id)
    override fun onReject() = NativeTelecom.end(id)
    override fun onAbort() = NativeTelecom.end(id)
    override fun onMuteStateChanged(isMuted: Boolean) { NativeTelecom.mute(id, isMuted); lastSystemMuted = isMuted }
    override fun onCallAudioStateChanged(state: CallAudioState) {
        audioState=state
        if(NativeCalls.state.value.call?.id==id&&(Build.VERSION.SDK_INT<34||endpoints.isEmpty()))NativeCalls.audioRouteChanged(legacyLabel(state.route))
        if (lastSystemMuted != null && lastSystemMuted != state.isMuted || lastSystemMuted == null && state.isMuted) NativeTelecom.mute(id, state.isMuted)
        lastSystemMuted = state.isMuted
    }
}

class VolnaConnectionService : ConnectionService() {
    override fun onConnectionServiceFocusGained() { super.onConnectionServiceFocusGained(); NativeTelecom.focusChanged(true) }
    override fun onConnectionServiceFocusLost() {
        NativeTelecom.focusChanged(false)
        // All microphone/camera/WebRTC resources are released before acknowledging Telecom.
        connectionServiceFocusReleased()
        super.onConnectionServiceFocusLost()
    }
    override fun onCreateIncomingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { NativeTelecom.creationFailed(requestId(request)) }
    override fun onCreateOutgoingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest) { NativeTelecom.creationFailed(requestId(request)) }

    private fun requestId(request: ConnectionRequest): String? = request.extras?.getString(NativeTelecom.CALL_ID)
        ?: request.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)?.getString(NativeTelecom.CALL_ID)
        ?: request.address?.takeIf { it.scheme == "volna" }?.schemeSpecificPart
    override fun onCreateIncomingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest): Connection = NativeTelecom.create(requestId(request))
    override fun onCreateOutgoingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest): Connection = NativeTelecom.create(requestId(request))
}
