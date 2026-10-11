package dev.volna.messenger

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
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

    fun configure(context: Context) {
        if (app != null) return
        app = context.applicationContext
        val handle = PhoneAccountHandle(ComponentName(context, VolnaConnectionService::class.java), "volna-voip")
        try {
            val telecom = context.getSystemService(TelecomManager::class.java) ?: return
            telecom.registerPhoneAccount(PhoneAccount.builder(handle, "Волна")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED or PhoneAccount.CAPABILITY_VIDEO_CALLING)
                .setSupportedUriSchemes(listOf("volna")).build())
            account = handle
        } catch (_: RuntimeException) { /* Calls continue through the existing app UI. */ }
        scope.launch { NativeCalls.state.collect { sync(it) } }
    }

    private fun sync(state: NativeCallState) {
        val call = state.call
        if (call == null || call.id != announced) {
            runCatching { connection?.finish() }; connection = null
            announced = null
        }
        if (call == null) return
        if (announced == null) {
            val context = app ?: return
            val handle = account ?: return
            announced = call.id
            try {
                val extras = Bundle().apply { putString(CALL_ID, call.id) }
                val telecom = context.getSystemService(TelecomManager::class.java)
                if (call.incoming) telecom.addNewIncomingCall(handle, extras)
                else telecom.placeCall(Uri.fromParts("volna", call.id, null), Bundle().apply {
                    putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
                    putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, extras)
                })
            } catch (_: RuntimeException) { /* No repeated registration or disruption of the call. */ }
        }
        runCatching { connection?.update(state) }
    }

    fun create(id: String?): Connection {
        val state = NativeCalls.state.value
        val call = state.call
        if (id == null || call == null || id != call.id || id != announced)
            return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        return VolnaConnection(id).also { created ->
            connection?.finish(); connection = created
            created.setCallerDisplayName(call.peer?.name ?: "Волна", TelecomManager.PRESENTATION_ALLOWED)
            created.update(state)
        }
    }

    fun answer(id: String, video: Boolean) {
        val context = app ?: return
        val call = NativeCalls.state.value.call ?: return
        if (!nativeTelecomActionAllowed(NativeCalls.state.value, id, incomingOnly = true)) return
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            NativeCalls.accept(video = video && call.video && context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        } else {
            // The normal activity requests microphone permission; no background recording.
            runCatching { IncomingCallActivity.pending(context, id, answer = true).send() }
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
    init {
        connectionProperties = PROPERTY_SELF_MANAGED
        audioModeIsVoip = true
        connectionCapabilities = CAPABILITY_MUTE or CAPABILITY_SUPPORTS_VT_LOCAL_BIDIRECTIONAL or CAPABILITY_SUPPORTS_VT_REMOTE_BIDIRECTIONAL
    }
    fun update(state: NativeCallState) {
        if (state.call?.id != id) { finish(); return }
        when {
            state.connected -> if (this.state != STATE_ACTIVE) setActive()
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
        if (lastSystemMuted != null && lastSystemMuted != state.isMuted || lastSystemMuted == null && state.isMuted) NativeTelecom.mute(id, state.isMuted)
        lastSystemMuted = state.isMuted
    }
}

class VolnaConnectionService : ConnectionService() {
    private fun requestId(request: ConnectionRequest): String? = request.extras?.getString(NativeTelecom.CALL_ID)
        ?: request.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)?.getString(NativeTelecom.CALL_ID)
        ?: request.address?.takeIf { it.scheme == "volna" }?.schemeSpecificPart
    override fun onCreateIncomingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest): Connection = NativeTelecom.create(requestId(request))
    override fun onCreateOutgoingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest): Connection = NativeTelecom.create(requestId(request))
}
