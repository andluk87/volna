package dev.volna.messenger

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import java.io.File
import java.util.UUID

internal class NativeRecorder(private val context: Context, private val scope: CoroutineScope, private val onError: (String) -> Unit) {
    var recording by mutableStateOf(false); private set
    var locked by mutableStateOf(false); private set
    var seconds by mutableStateOf(0); private set
    var wave by mutableStateOf(List(28) { .08f }); private set
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var timer: Job? = null
    var onSend: (File) -> Unit = {}
    var beforeStart: () -> Unit = {}
    fun lock() { if (recording) locked = true }
    fun start(lock: Boolean = false): Boolean {
        if (recording || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false
        var next: MediaRecorder? = null
        try {
            beforeStart()
            val output = File(context.filesDir, "voice-drafts/voice-${UUID.randomUUID()}.m4a")
            output.parentFile?.mkdirs()
            file = output
            next = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
            val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioEncodingBitRate(128_000); next.setAudioSamplingRate(48_000); next.setAudioChannels(1)
            next.setOutputFile(output.absolutePath); next.prepare(); next.start()
            file = output; recorder = next; seconds = 0; recording = true; locked = lock
            val started = SystemClock.elapsedRealtime()
            timer = scope.launch {
                while (recording) {
                    seconds = ((SystemClock.elapsedRealtime() - started) / 1000).toInt()
                    val peak = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0) / 32767f
                    wave = wave.drop(1) + (kotlin.math.sqrt(peak) * 1.6f).coerceIn(.08f, 1f)
                    if (seconds >= 300) { finish(); break }
                    delay(100)
                }
            }
            return true
        } catch (problem: Exception) { runCatching { next?.release() }; onError(problem.message ?: "Не удалось начать запись"); cancel(); return false }
    }
    fun finish() {
        if (!recording) return
        val output = file; file = null
        timer?.cancel(); timer = null
        try {
            recorder?.stop(); recorder?.release(); recorder = null; recording = false; locked = false
            if (output == null || output.length() == 0L) error("Запись слишком короткая")
            onSend(output)
        } catch (problem: Exception) { output?.delete(); onError("Запись слишком короткая или микрофон недоступен. Повторите запись.") }
        finally { runCatching { recorder?.release() }; recorder = null; recording = false; locked = false }
    }
    fun cancel() { timer?.cancel(); timer = null; runCatching { recorder?.stop() }; runCatching { recorder?.release() }; recorder = null; recording = false; locked = false; file?.delete(); file = null }
}

@Composable
internal fun NativeRecordButton(recorder: NativeRecorder, enabled: Boolean, requestPermission: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val accent = Accent
    val iconColor = Color.White
    val enabledNow by rememberUpdatedState(enabled)
    val askPermission by rememberUpdatedState(requestPermission)
    val pulse = if (recorder.recording && LocalMotionEnabled.current) {
        val transition = rememberInfiniteTransition(label = "recording-pulse")
        val value by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Restart), label = "microphone-size")
        value
    } else 0f
    val label = if (recorder.recording) "Отправить голосовое сообщение" else "Записать голосовое. Удерживайте для записи, смахните влево для отмены или вверх для фиксации. Нажатие включает запись до следующего нажатия."
    fun tap(): Boolean {
        if (!enabledNow) return false
        if (recorder.recording) recorder.finish() else if (!recorder.start(true)) askPermission()
        return true
    }
    Box(Modifier.size(48.dp).semantics {
        role = Role.Button; contentDescription = label; onClick(label) { tap() }
    }.pointerInput(enabled) {
        if (!enabled) return@pointerInput
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            val alreadyRecording = recorder.recording
            val started = if (!alreadyRecording) recorder.start() else true
            if (!started) askPermission()
            if (started) haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            val gesture = NativeVoiceGesture()
            var releasedAt = down.uptimeMillis
            try {
                do {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    releasedAt = change.uptimeMillis
                    if (started && !alreadyRecording) {
                        gesture.move((change.position.x - down.position.x) / density, (change.position.y - down.position.y) / density)
                        if (gesture.cancelled) recorder.cancel()
                        if (gesture.locked) recorder.lock()
                    }
                    change.consume()
                } while (event.changes.any { it.id == down.id && it.pressed })
                if (started && alreadyRecording) recorder.finish()
                else if (started) when (gesture.release(releasedAt - down.uptimeMillis)) { "cancel" -> recorder.cancel(); "lock" -> recorder.lock(); else -> recorder.finish() }
            } catch (cancelled: CancellationException) { if (!recorder.locked) recorder.cancel(); throw cancelled }
        }
    }, contentAlignment = Alignment.Center) {
        if (recorder.recording && LocalMotionEnabled.current) Canvas(Modifier.fillMaxSize()) {
            repeat(2) { index ->
                val phase = (pulse + index * .5f) % 1f
                drawCircle(Color(0xFFE35D6A).copy(alpha = (1f - phase) * .55f), radius = (19.dp.toPx() + phase * 4.dp.toPx()), style = Stroke(1.5.dp.toPx()))
            }
        }
        Box(Modifier.size(38.dp).clip(CircleShape).background(if (recorder.recording) Color(0xFFE35D6A) else accent), contentAlignment = Alignment.Center) { Icon(if (recorder.recording && recorder.locked) Icons.Outlined.Send else Icons.Outlined.Mic, null, tint = iconColor, modifier = Modifier.graphicsLayer { val scale = 1f + kotlin.math.sin(pulse * kotlin.math.PI).toFloat() * .18f; scaleX = scale; scaleY = scale }) } }
}

@Composable
internal fun NativeRecordingWave(wave: List<Float>, modifier: Modifier = Modifier) {
    val color = Color(0xFFE35D6A)
    val motion = LocalMotionEnabled.current
    val levels = wave.map { if (motion) animateFloatAsState(it, tween(100), label = "recording-level").value else it }
    Canvas(modifier.height(30.dp)) {
        val step = size.width / wave.size.coerceAtLeast(1)
        if (levels.isNotEmpty()) {
            val outline = Path().apply {
                levels.forEachIndexed { i, peak ->
                    val x = (i + .5f) * step
                    val y = size.height / 2 - (peak * size.height * .45f).coerceAtLeast(1.5.dp.toPx())
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
                levels.indices.reversed().forEach { i -> lineTo((i + .5f) * step, size.height / 2 + (levels[i] * size.height * .45f).coerceAtLeast(1.5.dp.toPx())) }
                close()
            }
            drawPath(outline, color.copy(alpha = .18f))
        }
        levels.forEachIndexed { i, peak -> val height = (peak * size.height).coerceAtLeast(3.dp.toPx()); val x = (i + .5f) * step; drawLine(lerp(color, Color.White, peak * .35f), Offset(x, (size.height - height) / 2), Offset(x, (size.height + height) / 2), strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round) }
    }
}

@Composable
internal fun NativeRecordingIndicator() {
    val motion = LocalMotionEnabled.current
    val opacity = if (motion) {
        val transition = rememberInfiniteTransition(label = "recording-indicator")
        val value by transition.animateFloat(.35f, 1f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "recording-dot")
        value
    } else 1f
    Box(Modifier.padding(end = 5.dp).size(7.dp).graphicsLayer { alpha = opacity }.clip(CircleShape).background(Color(0xFFE35D6A)))
}
