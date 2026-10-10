package dev.volna.messenger

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.util.LruCache
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.abs

internal data class NativeVoiceData(val file: File, val durationMs: Int, val wave: List<Float>)

/** Decode the actual recording once. Limit work and disk use; never invent a waveform. */
internal object NativeVoiceRepository {
    private val cache = LruCache<String, NativeVoiceData>(80)
    private val lock = Mutex()
    private val decodeLock = Mutex()
    suspend fun load(context: Context, token: String, message: VolnaMessage, waveform: Boolean = true): NativeVoiceData = withContext(Dispatchers.IO) {
        val id = message.attachmentId ?: error("Нет аудиовложения")
        val session = MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).take(12).joinToString("") { "%02x".format(it.toInt() and 255) }
        val key = "$session/$id"
        cache.get(key)?.takeIf { it.file.isFile }?.let { return@withContext it }
        val file = lock.withLock {
            val cacheRoot = File(context.cacheDir, "voices")
            val directory = File(cacheRoot, session).apply { mkdirs() }
            val file = File(directory, id)
            if (!file.isFile || file.length() == 0L || message.attachmentSize > 0 && file.length() != message.attachmentSize) {
                NativeApi(BuildConfig.API_BASE_URL).downloadAttachment(token, id, file)
            }
            file.setLastModified(System.currentTimeMillis())
            val cachedFiles = cacheRoot.walkTopDown().filter { it.isFile }.toList()
            var total = cachedFiles.sumOf { it.length() }
            cachedFiles.sortedBy { it.lastModified() }.forEach { old ->
                if (total > 64L * 1024 * 1024 && old != file && old.isFile) { val size = old.length(); if (old.delete()) total -= size }
            }
            file
        }
        // Playback never queues behind waveform decoding of other visible messages.
        if (!waveform) return@withContext NativeVoiceData(file, 0, emptyList())
        decodeLock.withLock {
            cache.get(key)?.takeIf { it.file.isFile } ?: decodeVoice(file).also { cache.put(key, it) }
        }
    }

    private suspend fun decodeVoice(file: File): NativeVoiceData {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var duration = 0
        val peaks = FloatArray(48)
        try {
            extractor.setDataSource(file.absolutePath)
            val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: return NativeVoiceData(file, 0, emptyList())
            val format = extractor.getTrackFormat(track)
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            duration = (durationUs / 1000).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
            // Match Web: long files still play, but aren't fully decoded just to draw bars.
            if (file.length() > 8L * 1024 * 1024 || durationUs <= 0) return NativeVoiceData(file, duration, emptyList())
            extractor.selectTrack(track)
            val decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME) ?: return NativeVoiceData(file, duration, emptyList()))
            codec = decoder
            decoder.configure(format, null, null, 0); decoder.start()
            val info = MediaCodec.BufferInfo()
            var inputEnded = false
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
            var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceAtLeast(1)
            var encoding = AudioFormat.ENCODING_PCM_16BIT
            val deadline = android.os.SystemClock.elapsedRealtime() + 10_000
            while (android.os.SystemClock.elapsedRealtime() < deadline) {
                currentCoroutineContext().ensureActive()
                if (!inputEnded) {
                    val inputIndex = decoder.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val input = decoder.getInputBuffer(inputIndex) ?: error("Нет буфера аудио")
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) { decoder.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true }
                        else { decoder.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val outputIndex = decoder.dequeueOutputBuffer(info, 10_000)
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val output = decoder.outputFormat
                    channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                    sampleRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceAtLeast(1)
                    if (output.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = output.getInteger(MediaFormat.KEY_PCM_ENCODING)
                } else if (outputIndex >= 0) {
                    val output = decoder.getOutputBuffer(outputIndex)?.order(ByteOrder.LITTLE_ENDIAN)
                    if (output != null) {
                        val bytes = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
                        val frames = info.size / (bytes * channels)
                        for (frame in 0 until frames step 4) {
                            val bin = (((info.presentationTimeUs + frame * 1_000_000L / sampleRate) * peaks.size) / durationUs).toInt().coerceIn(0, peaks.lastIndex)
                            val offset = info.offset + frame * bytes * channels
                            val peak = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) abs(output.getFloat(offset)) else abs(output.getShort(offset).toFloat() / 32768f)
                            peaks[bin] = maxOf(peaks[bin], peak.coerceIn(0f, 1f))
                        }
                    }
                    decoder.releaseOutputBuffer(outputIndex, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
            val maximum = peaks.maxOrNull()?.coerceAtLeast(.001f) ?: 1f
            return NativeVoiceData(file, duration, peaks.map { (it / maximum).coerceAtLeast(.07f) })
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return NativeVoiceData(file, duration, emptyList()) }
        finally { runCatching { codec?.stop() }; runCatching { codec?.release() }; extractor.release() }
    }
}

/** One player for all bubbles; stale callbacks cannot stop a newer recording. */
@Stable
internal class NativeVoicePlayback(context: Context, private val onError: (String) -> Unit) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("volna-native", 0)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var player: MediaPlayer? = null
    private var prepared = false
    private var generation = 0
    private var load: Job? = null
    private var ticker: Job? = null
    private var pendingSeek = 0
    private var playWhenReady = false
    var messageId by mutableStateOf(0L)
        private set
    var playing by mutableStateOf(false)
        private set
    var loading by mutableStateOf(false)
        private set
    var positionMs by mutableStateOf(0)
        private set
    var durationMs by mutableStateOf(0)
        private set
    var speed by mutableStateOf(prefs.getFloat("voice_speed", 1f).takeIf { it in listOf(1f, 1.5f, 2f) } ?: 1f)
        private set

    fun toggle(token: String, message: VolnaMessage) {
        if (NativeCalls.state.value.call != null) { onError("Аудиосообщения доступны после завершения звонка"); return }
        if (messageId == message.id && prepared) {
            try { if (playing) { player?.pause(); playing = false; ticker?.cancel() } else { player?.start(); playing = true; startTicker() } }
            catch (problem: Exception) { fail(problem) }
        } else if (messageId != message.id || !loading) open(token, message, 0, play = true)
    }
    fun seek(token: String, message: VolnaMessage, milliseconds: Int) {
        if (NativeCalls.state.value.call != null) { onError("Аудиосообщения доступны после завершения звонка"); return }
        if (messageId == message.id && prepared) {
            val position = milliseconds.coerceIn(0, durationMs)
            try { player?.seekTo(position.toLong(), MediaPlayer.SEEK_CLOSEST); positionMs = position }
            catch (problem: Exception) { fail(problem) }
        } else if (messageId == message.id && loading) { pendingSeek = milliseconds; playWhenReady = false; positionMs = milliseconds }
        else open(token, message, milliseconds, play = false)
    }
    fun changeSpeed() {
        val next = when (speed) { 1f -> 1.5f; 1.5f -> 2f; else -> 1f }
        try {
            if (prepared) { player?.playbackParams = player!!.playbackParams.setSpeed(next); if (!playing) player?.pause() }
            speed = next; prefs.edit().putFloat("voice_speed", next).apply()
        } catch (problem: Exception) { onError(problem.message ?: "Не удалось изменить скорость") }
    }
    private fun open(token: String, message: VolnaMessage, seekMs: Int, play: Boolean) {
        stop()
        val version = generation
        messageId = message.id; loading = true
        pendingSeek = seekMs; playWhenReady = play
        load = scope.launch {
            try {
                val audio = NativeVoiceRepository.load(app, token, message, waveform = false)
                if (version != generation) return@launch
                val next = MediaPlayer().also { player = it }
                next.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                next.setDataSource(audio.file.absolutePath)
                next.setOnPreparedListener {
                    if (version != generation || player !== it) return@setOnPreparedListener
                    try {
                        prepared = true; loading = false; durationMs = it.duration.coerceAtLeast(0)
                        positionMs = pendingSeek.coerceIn(0, durationMs)
                        it.playbackParams = it.playbackParams.setSpeed(speed)
                        it.seekTo(positionMs.toLong(), MediaPlayer.SEEK_CLOSEST)
                        if (playWhenReady) { it.start(); playing = true; startTicker() } else it.pause()
                    } catch (problem: Exception) { fail(problem) }
                }
                next.setOnCompletionListener { if (version == generation && player === it) { playing = false; positionMs = 0; ticker?.cancel() } }
                next.setOnErrorListener { failed, _, _ -> if (version == generation && player === failed) fail(IllegalStateException("Не удалось воспроизвести аудио")); true }
                next.prepareAsync()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { if (version == generation) fail(problem) }
        }
    }
    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch { while (isActive && playing) { positionMs = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0); delay(100) } }
    }
    private fun fail(problem: Exception) { stop(); onError(problem.message ?: "Не удалось открыть аудио") }
    fun stop() {
        generation++; load?.cancel(); load = null; ticker?.cancel(); ticker = null
        val old = player; player = null; prepared = false
        old?.setOnPreparedListener(null); old?.setOnCompletionListener(null); old?.setOnErrorListener(null)
        runCatching { old?.release() }
        playing = false; loading = false; messageId = 0; positionMs = 0; durationMs = 0
        pendingSeek = 0; playWhenReady = false
    }
    fun close() { stop(); scope.cancel() }
}

@Composable
internal fun NativeVoiceMessage(message: VolnaMessage, token: String, playback: NativeVoicePlayback, onPlay: () -> Unit, transcribing: Boolean, onTranscribe: () -> Unit, isMine: Boolean = false) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var metadata by remember(message.attachmentId, token) { mutableStateOf<NativeVoiceData?>(null) }
    var showTranscript by remember(message.id) { mutableStateOf(false) }
    var requestedTranscript by remember(message.id) { mutableStateOf(false) }
    LaunchedEffect(message.attachmentId, token) {
        if (message.attachmentSize <= 5L * 1024 * 1024) try { metadata = NativeVoiceRepository.load(context, token, message) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* The play button can retry and show a useful error. */ }
    }
    LaunchedEffect(message.transcript) { if (requestedTranscript && !message.transcript.isNullOrBlank()) { showTranscript = true; requestedTranscript = false } }
    val selected = playback.messageId == message.id
    val duration = if (selected && playback.durationMs > 0) playback.durationMs else metadata?.durationMs ?: 0
    val position = if (selected) playback.positionMs.coerceIn(0, duration.coerceAtLeast(0)) else 0
    val progress = if (duration > 0) position.toFloat() / duration else 0f
    val wave = metadata?.wave?.takeIf { it.isNotEmpty() } ?: List(48) { .12f }
    val accent = Accent
    val seek: (Float) -> Unit = { fraction -> if (duration > 0) playback.seek(token, message, (fraction.coerceIn(0f, 1f) * duration).toInt()) }
    val waveColor = if (isMine) TextMain else accent
    Column(Modifier.fillMaxWidth()) {
        if (!message.attachmentName.orEmpty().startsWith("Голосовое-")) NativeText(message.attachmentName.orEmpty(), fontSize = 11.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(Modifier.fillMaxWidth().heightIn(min = 50.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            IconButton(onClick = onPlay, modifier = Modifier.size(42.dp).clip(CircleShape).background(accent)) {
                if (selected && playback.loading) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Icon(if (selected && playback.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (selected && playback.playing) "Пауза" else "Воспроизвести голосовое", tint = Color.White, modifier = Modifier.size(25.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Canvas(Modifier.fillMaxWidth().height(20.dp).semantics {
                    contentDescription = "Перемотка голосового"
                    progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f)
                    setProgress { fraction -> if (duration <= 0) false else { seek(fraction); true } }
                }.pointerInput(duration) { detectTapGestures { seek(it.x / size.width.coerceAtLeast(1)) } }
                    .pointerInput(duration) { detectDragGestures(onDragStart = { seek(it.x / size.width.coerceAtLeast(1)) }) { change, _ -> change.consume(); seek(change.position.x / size.width.coerceAtLeast(1)) } }) {
                    val bars = (size.width / 4.dp.toPx()).toInt().coerceIn(1, wave.size)
                    val step = size.width / bars
                    repeat(bars) { i ->
                        val from = i * wave.size / bars
                        val to = ((i + 1) * wave.size / bars).coerceAtLeast(from + 1)
                        val peak = wave.subList(from, to.coerceAtMost(wave.size)).maxOrNull() ?: .07f
                        val height = (peak * size.height).coerceAtLeast(3.dp.toPx())
                        val x = step * (i + .5f)
                        drawLine(waveColor.copy(alpha = if (position > 0 && (i + .5f) / bars <= progress) 1f else .4f), Offset(x, (size.height - height) / 2), Offset(x, (size.height + height) / 2), strokeWidth = 2.dp.toPx().coerceAtMost(step * .6f), cap = StrokeCap.Round)
                    }
                }
                NativeText(if (duration > 0) if (selected && position > 0) "${voiceDuration(position)} / ${voiceDuration(duration)}" else voiceDuration(duration) else "—:—", color = Muted, fontSize = 11.sp, maxLines = 1)
            }
            if (selected) Box(Modifier.size(30.dp).clip(CircleShape).background(waveColor.copy(alpha = .1f)).clickable(onClickLabel = "Скорость воспроизведения", onClick = playback::changeSpeed), contentAlignment = Alignment.Center) {
                NativeText(if (playback.speed == 1.5f) "1.5×" else "${playback.speed.toInt()}×", color = waveColor, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
            if (message.attachmentName.orEmpty().startsWith("Голосовое-")) Box(Modifier.align(Alignment.Top).padding(top = 2.dp).width(36.dp).height(26.dp).clip(RoundedCornerShape(8.dp)).background(waveColor.copy(alpha = .16f)).clickable(enabled = !transcribing, onClickLabel = "Расшифровать голосовое") {
                if (!message.transcript.isNullOrBlank()) showTranscript = !showTranscript else { requestedTranscript = true; onTranscribe() }
            }, contentAlignment = Alignment.Center) {
                if (transcribing) CircularProgressIndicator(Modifier.size(18.dp), color = waveColor, strokeWidth = 2.dp)
                else Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.ArrowForward, null, tint = waveColor, modifier = Modifier.size(13.dp)); NativeText("А", color = waveColor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
        if (showTranscript && !message.transcript.isNullOrBlank()) NativeText(message.transcript.orEmpty(), color = TextMain, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

private fun voiceDuration(milliseconds: Int) = "%02d:%02d".format(milliseconds / 60_000, milliseconds / 1000 % 60)
