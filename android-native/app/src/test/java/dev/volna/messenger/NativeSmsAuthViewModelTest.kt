package dev.volna.messenger

import android.content.Intent
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class NativeSmsAuthViewModelTest {
    private class Monitor : NativeSmsMonitor {
        override val appHash = "AbCdEfGhIjK"
        var receive: (String) -> Unit = {}; var timeout: () -> Unit = {}; var stops = 0; var starts = 0; var supported = true
        override suspend fun start(retriever: Boolean, onMessage: (String) -> Unit, onConsent: (Intent) -> Unit, onTimeout: () -> Unit): Boolean { starts++; receive = onMessage; timeout = onTimeout; return supported }
        override fun stop() { stops++ }
    }
    private class Repository : NativeAuthRepository {
        var sends = 0; var verifies = 0; var lastCode = ""; var beforeResponse: () -> Unit = {}
        var fail: Exception? = null; var gate: CompletableDeferred<Unit>? = null; val requests = mutableListOf<String>()
        val id = "abcdefgh" + "A".repeat(35)
        override suspend fun config() = JSONObject().put("sms_retriever_hashes", JSONArray().put("AbCdEfGhIjK"))
        fun info() = JSONObject().put("challenge_id",id).put("masked_phone","+7 900 *** ** 67").put("server_time",1000L).put("expires_at",301000L).put("resend_available_at",61000L).put("sms_nonce","abcdefgh").put("sms_retriever",true).put("status","sent")
        override suspend fun start(phone: String, request: String, hash: String): JSONObject { sends++; requests.add(request); beforeResponse(); fail?.let { throw it }; return info() }
        override suspend fun resend(id: String, request: String) = start("",request,"")
        override suspend fun status(id: String) = info()
        override suspend fun cancel(id: String) {}
        override suspend fun verify(id: String, code: String): VolnaSession { verifies++; lastCode=code; gate?.await(); fail?.let { throw it }; return VolnaSession("token",VolnaUser(1,"test","Test"),"refresh") }
    }
    private fun message(nonce: String = "abcdefgh") = "<#> Код входа в Волна: 001234\nПопытка: $nonce\nAbCdEfGhIjK"
    @Test fun earlySmsIsBufferedThenVerifiedExactlyOnce() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val repository=Repository();val monitor=Monitor();var stored=0
        val model=NativeSmsAuthViewModel(null,null,SavedStateHandle(),repository,monitor,{testScheduler.currentTime},{stored++})
        try {
            model.editPhone("9001234567");repository.beforeResponse={monitor.receive(message())}
            model.send();model.send();runCurrent()
            assertEquals(1,repository.sends);assertEquals(1,repository.verifies);assertEquals("001234",repository.lastCode);assertEquals(1,stored)
            monitor.receive(message());runCurrent();assertEquals(1,repository.verifies);assertEquals(NativeAuthPhase.AUTHENTICATED,model.state.value.phase)
        } finally {model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun oldSmsAndEventsDuringManualVerificationAreIgnored() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor()
        val model=NativeSmsAuthViewModel(null,null,SavedStateHandle(),repository,monitor,{testScheduler.currentTime},{})
        try {
            model.editPhone("9001234567");model.send();runCurrent();monitor.receive(message("previous"));runCurrent();assertEquals(0,repository.verifies)
            repository.gate=CompletableDeferred();model.editCode("001-234");runCurrent();monitor.receive(message());runCurrent();assertEquals(1,repository.verifies)
            val previousReceiver=monitor.receive;model.back();previousReceiver(message());runCurrent();assertEquals(NativeAuthPhase.PHONE_INPUT,model.state.value.phase);assertEquals(1,repository.verifies)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun invalidCodeClearsInputAndDoesNotAutomaticallyRepeat() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor()
        val model=NativeSmsAuthViewModel(null,null,SavedStateHandle(),repository,monitor,{testScheduler.currentTime},{})
        try {
            model.editPhone("9001234567");model.send();runCurrent();repository.fail=NativeApiException(400,"Неверный код","INVALID_CODE")
            monitor.receive(message());runCurrent();assertEquals(NativeAuthPhase.INVALID_CODE,model.state.value.phase);assertEquals("",model.state.value.code)
            monitor.receive(message());runCurrent();assertEquals(1,repository.verifies)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun networkRetryKeepsCodeOnlyInMemoryAndReusesSendingRequestId() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor();val saved=SavedStateHandle()
        val model=NativeSmsAuthViewModel(null,null,saved,repository,monitor,{testScheduler.currentTime},{})
        try {
            model.editPhone("9001234567");repository.fail=IOException();model.send();runCurrent();repository.fail=null;model.send();runCurrent()
            assertEquals(repository.requests[0],repository.requests[1]);assertEquals(1,repository.requests.toSet().size)
            repository.fail=IOException();model.editCode("001234");runCurrent();assertEquals("001234",model.state.value.code);assertTrue(model.state.value.retryVerification);assertFalse(saved.keys().contains("code"))
            repository.fail=null;model.retryVerification();runCurrent();assertEquals(NativeAuthPhase.AUTHENTICATED,model.state.value.phase)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun noPlayServicesStillAllowsManualAutomaticVerification() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor().apply { supported=false }
        val model=NativeSmsAuthViewModel(null,null,SavedStateHandle(),repository,monitor,{testScheduler.currentTime},{})
        try {
            model.editPhone("9001234567");model.send();runCurrent();assertFalse(model.state.value.listening);assertEquals(NativeAuthPhase.WAITING_SMS,model.state.value.phase)
            model.editCode("001234");runCurrent();assertEquals(1,repository.verifies);assertEquals(NativeAuthPhase.AUTHENTICATED,model.state.value.phase)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun restoredChallengeRechecksServerWithoutSendingOrRestoringOtp() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor()
        val saved=SavedStateHandle(mapOf("challenge" to repository.id,"country" to "+7","phone" to "9001234567","masked" to "+7 900 *** ** 67"))
        val model=NativeSmsAuthViewModel(null,null,saved,repository,monitor,{testScheduler.currentTime},{})
        try {
            runCurrent();assertEquals(0,repository.sends);assertEquals("",model.state.value.code);assertTrue(model.state.value.listening);assertEquals(60L,model.state.value.resendSeconds)
            monitor.receive(message());runCurrent();assertEquals(1,repository.verifies);assertEquals(NativeAuthPhase.AUTHENTICATED,model.state.value.phase)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }
    @Test fun timeoutKeepsManualEntryButServerExpiryPreventsUsingLateSms() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler));val repository=Repository();val monitor=Monitor()
        val model=NativeSmsAuthViewModel(null,null,SavedStateHandle(),repository,monitor,{testScheduler.currentTime},{})
        try {
            model.editPhone("9001234567");model.send();runCurrent();monitor.timeout();assertFalse(model.state.value.listening);assertEquals(NativeAuthPhase.SMS_TIMEOUT,model.state.value.phase)
            advanceTimeBy(60000);runCurrent();assertEquals(0L,model.state.value.resendSeconds)
            advanceTimeBy(240000);runCurrent();assertEquals(0L,model.state.value.expiresSeconds);monitor.receive(message());runCurrent();assertEquals(0,repository.verifies)
        }finally{model.viewModelScope.cancel();Dispatchers.resetMain()}
    }

}
