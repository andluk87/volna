package dev.volna.messenger

import android.Manifest
import android.app.ActivityOptions
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.withResumed
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Call controls may appear over the keyguard; opening chats still requires unlocking. */
class IncomingCallActivity : ComponentActivity() {
    private var expectedId by mutableStateOf("")
    private var resolved by mutableStateOf(false)
    private var answerRequested = false
    private val microphone = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) { answerRequested = false; NativeCalls.state.value.call?.takeIf { it.id == expectedId && it.incoming && it.status == "ringing" }?.let { NativeCalls.accept(video = it.video && granted[Manifest.permission.CAMERA] == true) } } else answerRequested = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        val token = NativeCredentials.access(getSharedPreferences("volna-native", MODE_PRIVATE).getLong("user_id",0))
        if (token.isBlank()) { finish(); return }
        NativeCalls.configure(this, token)
        receive(intent)
        setContent { NativeEmojiProvider {
            val state by NativeCalls.state.collectAsState()
            val appearance = remember { val account = getSharedPreferences("volna-native", MODE_PRIVATE).getLong("user_id", 0); val prefs = getSharedPreferences("volna-appearance-$account", MODE_PRIVATE); NativeAppearance.load(if (prefs.all.isEmpty()) getSharedPreferences("volna-appearance", MODE_PRIVATE) else prefs) }
            LaunchedEffect(state.call?.id, resolved, expectedId) {
                if (resolved && state.call?.id != expectedId) finish()
            }
            DisposableEffect(state.call?.status) {
                if (state.call?.incoming == true && state.call?.status == "ringing") window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            }
            VolnaTheme(appearance) {
                if (state.call?.id == expectedId) NativeCallScreen(state, token, standalone = true, onMinimize = ::openChat)
                else Box(Modifier.fillMaxSize().background(Ink), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Accent)
                        NativeText("Проверяем звонок…", color = Muted, modifier = Modifier.padding(top = 20.dp))
                    }
                }
            }
        } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receive(intent) }

    private fun receive(intent: Intent) {
        val id = intent.getStringExtra(EXTRA_CALL_ID).orEmpty()
        if (id.isBlank()) { finish(); return }
        expectedId = id; resolved = false
        answerRequested = intent.action == ACTION_ANSWER
        lifecycleScope.launch {
            val call = withTimeoutOrNull(12_000) { NativeCalls.state.first { it.call != null }.call }
            if (expectedId != id) return@launch
            resolved = true
            if (call?.id != id) { finish(); return@launch }
            NativeCalls.minimize(false)
            lifecycle.withResumed { if (answerRequested) answerCurrent() }
        }
    }

    private fun answerCurrent() {
        val call = NativeCalls.state.value.call ?: return
        if (call.id != expectedId || !call.incoming || call.status != "ringing") return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || call.video && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            microphone.launch(if (call.video) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO)); return
        }
        answerRequested = false
        NativeCalls.accept(video = call.video)
    }

    private fun openChat() {
        val open = {
            NativeCalls.minimize(true)
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            finish()
        }
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard.isKeyguardLocked) keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() { open() }
        }) else open()
    }

    companion object {
        const val EXTRA_CALL_ID = "call_id"
        private const val ACTION_ANSWER = "dev.volna.messenger.ANSWER_CALL"
        fun pending(context: Context, callId: String, answer: Boolean = false): PendingIntent {
            val intent = Intent(context, IncomingCallActivity::class.java)
                .setAction(if (answer) ACTION_ANSWER else "dev.volna.messenger.SHOW_CALL")
                .setData(Uri.parse("volna-call://call/$callId/${if (answer) "answer" else "show"}"))
                .putExtra(EXTRA_CALL_ID, callId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val options = if (Build.VERSION.SDK_INT >= 35) ActivityOptions.makeBasic().apply {
                setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            }.toBundle() else null
            return PendingIntent.getActivity(context, if (answer) 11036 else 11035, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE, options)
        }
    }
}
