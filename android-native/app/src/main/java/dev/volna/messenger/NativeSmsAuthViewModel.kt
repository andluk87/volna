package dev.volna.messenger

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

internal enum class NativeAuthPhase { PHONE_INPUT, STARTING_VERIFICATION, WAITING_SMS, SMS_RECEIVED, VERIFYING_CODE, INVALID_CODE, SMS_TIMEOUT, RESEND_AVAILABLE, AUTHENTICATED, ERROR }
internal data class NativeAuthState(
    val phase: NativeAuthPhase = NativeAuthPhase.PHONE_INPUT,
    val country: String = "+7", val phone: String = "", val challenge: String = "", val maskedPhone: String = "",
    val code: String = "", val error: String = "", val resendSeconds: Long = 0, val expiresSeconds: Long = 0,
    val listening: Boolean = false, val consent: Boolean = false, val retryVerification: Boolean = false,
    val consentIntent: Intent? = null, val generation: Int = 0, val session: VolnaSession? = null
) {
    val busy: Boolean get() = phase == NativeAuthPhase.STARTING_VERIFICATION || phase == NativeAuthPhase.VERIFYING_CODE || phase == NativeAuthPhase.SMS_RECEIVED
}

internal interface NativeAuthRepository {
    suspend fun config(): JSONObject
    suspend fun start(phone: String, request: String, hash: String): JSONObject
    suspend fun resend(id: String, request: String): JSONObject
    suspend fun status(id: String): JSONObject
    suspend fun cancel(id: String)
    suspend fun verify(id: String, code: String): VolnaSession
}

internal class NativeApiAuthRepository(private val api: NativeApi) : NativeAuthRepository {
    override suspend fun config() = withContext(Dispatchers.IO) { api.otpConfig() }
    override suspend fun start(phone: String, request: String, hash: String) = withContext(Dispatchers.IO) { api.otpStart(phone, request, hash) }
    override suspend fun resend(id: String, request: String) = withContext(Dispatchers.IO) { api.otpResend(id, request) }
    override suspend fun status(id: String) = withContext(Dispatchers.IO) { api.otpStatus(id) }
    override suspend fun cancel(id: String) = withContext(Dispatchers.IO) { api.otpCancel(id) }
    override suspend fun verify(id: String, code: String) = withContext(Dispatchers.IO) { api.otpVerify(id, code) }
}

internal class NativeSmsAuthViewModel(context: Context?, api: NativeApi?, private val saved: SavedStateHandle,
    private val repository: NativeAuthRepository = NativeApiAuthRepository(requireNotNull(api)),
    private val sms: NativeSmsMonitor = NativeSmsRetrieverManager(requireNotNull(context).applicationContext),
    private val elapsed: () -> Long = { SystemClock.elapsedRealtime() },
    private val storeSession: (VolnaSession) -> Unit = { NativeCredentials.store(it) }
) : ViewModel() {
    private val appContext = context?.applicationContext
    private fun text(id: Int, fallback: String): String = appContext?.getString(id) ?: fallback
    private val mutable = MutableStateFlow(NativeAuthState(country = saved["country"] ?: "+7", phone = saved["phone"] ?: ""))
    val state = mutable.asStateFlow()
    private var generation = 0
    private var work: Job? = null
    private var nonce = ""
    private var expectedHash: String? = null
    private var bufferedMessage: String? = null
    private var expiresAt = 0L
    private var resendAt = 0L
    private val rejectedAutoCodes = mutableSetOf<String>()

    init {
        val id = saved.get<String>("challenge").orEmpty()
        if (id.isNotEmpty()) {
            mutable.value = mutable.value.copy(challenge = id, maskedPhone = saved["masked"] ?: "", phase = NativeAuthPhase.STARTING_VERIFICATION)
            work = viewModelScope.launch {
                try {
                    val info = repository.status(id)
                    if (info.optString("status") == "sent") { applyChallenge(info); listen(expectedHash != null, generation) }
                    else { mutable.value = mutable.value.copy(phase = NativeAuthPhase.SMS_TIMEOUT, error = text(R.string.sms_auth_expired, "Код истёк. Запросите новый.")); saved.remove<String>("challenge") }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (problem: Exception) { mutable.value = mutable.value.copy(phase = NativeAuthPhase.ERROR, error = friendly(problem)) }
            }
        }
        viewModelScope.launch {
            while (isActive) {
                tick(); delay(500)
            }
        }
    }
    fun editPhone(value: String) { if (!state.value.busy) { saved["phone"] = value.filter { it in "+0123456789 ()-" }.take(40); mutable.value = state.value.copy(phone = saved["phone"] ?: "", error = "") } }
    fun editCountry(value: String) { if (!state.value.busy) { saved["country"] = value; mutable.value = state.value.copy(country = value, error = "") } }

    private fun tick() {
        val current = state.value
        val now = elapsed()
        val expires = ((expiresAt - now + 999) / 1000).coerceAtLeast(0)
        val resend = ((resendAt - now + 999) / 1000).coerceAtLeast(0)
        var phase = current.phase
        var error = current.error
        if (expiresAt > 0 && expires == 0L && !current.busy && current.session == null) { phase = NativeAuthPhase.SMS_TIMEOUT; error = if (current.phase == NativeAuthPhase.ERROR && current.error.isNotBlank()) current.error else text(R.string.sms_auth_expired, "Код истёк. Запросите новый."); sms.stop() }
        else if (resend == 0L && phase == NativeAuthPhase.WAITING_SMS) phase = NativeAuthPhase.RESEND_AVAILABLE
        mutable.value = current.copy(expiresSeconds = expires, resendSeconds = resend, phase = phase, error = error, listening = current.listening && expires > 0)
    }
    private fun applyChallenge(info: JSONObject) {
        val now = elapsed(); val serverNow = info.getLong("server_time")
        expiresAt = now + (info.getLong("expires_at") - serverNow).coerceAtLeast(0)
        resendAt = now + (info.getLong("resend_available_at") - serverNow).coerceAtLeast(0)
        nonce = info.getString("sms_nonce")
        expectedHash = sms.appHash.takeIf { info.optBoolean("sms_retriever") }
        val id = info.getString("challenge_id")
        saved["challenge"] = id; saved["masked"] = info.getString("masked_phone")
        mutable.value = state.value.copy(challenge = id, maskedPhone = info.getString("masked_phone"), code = "", phase = NativeAuthPhase.WAITING_SMS, error = "", retryVerification = false)
        tick()
    }
    private suspend fun listen(retriever: Boolean, activeGeneration: Int) {
        val onMessage: (String) -> Unit = { if (activeGeneration == generation) receive(it, activeGeneration) }
        val onConsent: (Intent) -> Unit = { if (activeGeneration == generation && state.value.session == null) mutable.value = state.value.copy(consentIntent = it, generation = activeGeneration) }
        val onTimeout: () -> Unit = { if (activeGeneration == generation) mutable.value = state.value.copy(phase = if (state.value.busy) state.value.phase else NativeAuthPhase.SMS_TIMEOUT, listening = false) }
        var consent = !retriever
        var started = sms.start(retriever, onMessage, onConsent, onTimeout)
        if (!started && retriever && activeGeneration == generation) {
            consent = true
            started = sms.start(false, onMessage, onConsent, onTimeout)
        }
        if (activeGeneration == generation) mutable.value = state.value.copy(listening = started, consent = consent && started)
    }
    fun send() {
        val current = state.value
        if (current.busy || current.session != null || current.resendSeconds > 0) return
        val number = try { nativeSmsPhone(current.country, current.phone) } catch (problem: IllegalArgumentException) { mutable.value = current.copy(error = problem.message.orEmpty()); return }
        val oldId = current.challenge
        generation++; val active = generation
        sms.stop(); nonce = ""; bufferedMessage = null; rejectedAutoCodes.clear()
        mutable.value = current.copy(phase = NativeAuthPhase.STARTING_VERIFICATION, code = "", error = "", consentIntent = null, retryVerification = false, generation = active)
        // Reuse the request ID after a network failure: the server must not send twice.
        val request = saved.get<String>("pending_request") ?: UUID.randomUUID().toString().also { saved["pending_request"] = it }
        work = viewModelScope.launch {
            try {
                val hashes = try { repository.config().optJSONArray("sms_retriever_hashes") } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { null }
                val retriever = sms.appHash.isNotEmpty() && (0 until (hashes?.length() ?: 0)).any { hashes?.optString(it) == sms.appHash }
                expectedHash = if (retriever) sms.appHash else null
                listen(retriever, active) // Listener is ready BEFORE the sending request.
                val info = if (oldId.isEmpty()) repository.start(number, request, if (retriever) sms.appHash else "") else repository.resend(oldId, request)
                if (active != generation) return@launch
                saved.remove<String>("pending_request")
                applyChallenge(info)
                bufferedMessage?.let { bufferedMessage = null; receive(it, active) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) {
                if (active != generation) return@launch
                sms.stop()
                if (problem is NativeApiException && problem.errorCode != "REQUEST_IN_PROGRESS") saved.remove<String>("pending_request")
                if (problem is NativeApiException && problem.retryAt > 0) resendAt = elapsed() + (problem.retryAt - (problem.serverTime.takeIf { it > 0 } ?: System.currentTimeMillis())).coerceAtLeast(0)
                mutable.value = state.value.copy(phase = NativeAuthPhase.ERROR, listening = false, error = friendly(problem)); tick()
            }
        }
    }
    fun consumeConsent() { mutable.value = state.value.copy(consentIntent = null) }
    fun consentResult(message: String?, activeGeneration: Int) { if (message != null && activeGeneration == generation) receive(message, activeGeneration) }
    private fun receive(message: String, activeGeneration: Int) {
        val current = state.value
        if (activeGeneration != generation || current.session != null || current.phase == NativeAuthPhase.VERIFYING_CODE) return
        if (current.phase == NativeAuthPhase.STARTING_VERIFICATION) { bufferedMessage = message.take(140); return }
        if (current.challenge.isEmpty() || current.expiresSeconds <= 0) return
        val code = NativeSmsCodeParser.parse(message, nonce, expectedHash) ?: return
        if (code in rejectedAutoCodes) return
        mutable.value = current.copy(code = code, phase = NativeAuthPhase.SMS_RECEIVED, error = "")
        verify(code)
    }
    fun editCode(value: String) {
        val current = state.value
        if (current.busy || current.expiresSeconds <= 0 || current.session != null) return
        val digits = value.filter { it in '0'..'9' }.take(6)
        mutable.value = current.copy(code = digits, error = "", phase = NativeAuthPhase.WAITING_SMS, retryVerification = false)
        if (digits.length == 6) verify(digits)
    }
    fun retryVerification() { if (state.value.retryVerification && state.value.code.length == 6) verify(state.value.code) }
    private fun verify(code: String) {
        val current = state.value
        if (current.phase == NativeAuthPhase.VERIFYING_CODE || current.challenge.isEmpty() || current.expiresSeconds <= 0 || current.session != null) return
        val active = generation; val id = current.challenge
        mutable.value = current.copy(phase = NativeAuthPhase.VERIFYING_CODE, code = code, error = "", retryVerification = false)
        work = viewModelScope.launch {
            try {
                val session = repository.verify(id, code)
                if (active != generation) return@launch
                storeSession(session)
                sms.stop(); saved.remove<String>("challenge"); saved.remove<String>("pending_request")
                mutable.value = state.value.copy(phase = NativeAuthPhase.AUTHENTICATED, code = "", listening = false, session = session)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) {
                if (active != generation) return@launch
                val invalid = problem is NativeApiException && problem.errorCode == "INVALID_CODE"
                val expired = problem is NativeApiException && problem.errorCode in listOf("CODE_EXPIRED", "ATTEMPTS_EXCEEDED", "CHALLENGE_NOT_FOUND")
                if (invalid || expired) rejectedAutoCodes.add(code)
                if (expired) { expiresAt = elapsed(); sms.stop() }
                mutable.value = state.value.copy(phase = if (invalid) NativeAuthPhase.INVALID_CODE else NativeAuthPhase.ERROR,
                    code = if (invalid || expired) "" else code, error = friendly(problem), retryVerification = !invalid && !expired, listening = state.value.listening && !expired)
                tick()
            }
        }
    }
    fun back() {
        val oldId = state.value.challenge
        generation++; work?.cancel(); sms.stop(); bufferedMessage = null; nonce = ""; expectedHash = null
        expiresAt = 0; resendAt = 0; rejectedAutoCodes.clear()
        saved.remove<String>("challenge"); saved.remove<String>("pending_request"); saved.remove<String>("masked")
        mutable.value = NativeAuthState(country = state.value.country, phone = state.value.phone, generation = generation)
        if (oldId.isNotEmpty()) viewModelScope.launch { runCatching { repository.cancel(oldId) } }
    }
    fun resume() {
        val current = state.value
        if (current.challenge.isBlank() || current.busy || current.session != null) return
        val active = generation
        viewModelScope.launch {
            try {
                val info = repository.status(current.challenge)
                if (active != generation || state.value.busy || state.value.challenge != current.challenge) return@launch
                if (info.optString("status") != "sent") { expiresAt = elapsed(); tick() }
            } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Local monotonic countdown remains valid while offline. */ }
        }
    }
    private fun friendly(problem: Exception): String = when {
        problem is IOException -> text(R.string.sms_auth_offline, "Нет подключения к интернету. Проверьте сеть и повторите.")
        problem is NativeApiException && problem.status == 429 -> text(R.string.sms_auth_rate_limited, "Слишком много попыток. Попробуйте позже.")
        else -> problem.message ?: text(R.string.sms_auth_request_failed, "Не удалось выполнить запрос. Повторите позже.")
    }
    override fun onCleared() { sms.stop(); bufferedMessage = null; super.onCleared() }
}
