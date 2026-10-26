package dev.volna.messenger

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.rememberLottieAnimatable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.zip.GZIPInputStream

internal object NativeAnimatedEmojiAssets {
    private var files: Map<String, String>? = null
    @Synchronized fun file(context: Context, text: String): String? {
        val index = files ?: runCatching {
            val json = JSONObject(context.assets.open("animated-emoji/index.json").bufferedReader().use { it.readText() })
            json.keys().asSequence().associateWith { json.getString(it) }
        }.getOrDefault(emptyMap()).also { files = it }
        return index[text.replace("\uFE0F", "")]
    }
}

@Composable
internal fun NativeAnimatedEmoji(text: String, replay: Int) {
    val context = LocalContext.current
    val file = remember(text) { NativeAnimatedEmojiAssets.file(context, text) }
    if (file == null) { NativeText(text, fontSize = 96.sp, lineHeight = 104.sp); return }
    val owner = LocalLifecycleOwner.current
    val motion = LocalMotionEnabled.current
    var visible by remember(file) { mutableStateOf(false) }
    var foreground by remember(owner) { mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var composition by remember(file) { mutableStateOf<LottieComposition?>(null) }
    var failed by remember(file) { mutableStateOf(false) }
    var runningReplay by remember(file) { mutableIntStateOf(-1) }
    var finishedReplay by remember(file) { mutableIntStateOf(-1) }
    val animation = rememberLottieAnimatable()
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, _ -> foreground = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(file, visible) {
        if (visible && composition == null && !failed) {
            composition = withContext(Dispatchers.IO) {
                runCatching { GZIPInputStream(context.assets.open("animated-emoji/$file")).use { LottieCompositionFactory.fromJsonInputStreamSync(it, "emoji:$file").value } }.getOrNull()
            }
            failed = composition == null
        }
    }
    LaunchedEffect(composition, replay, visible, foreground, motion) {
        val loaded = composition ?: return@LaunchedEffect
        if (visible && foreground && (motion || replay > 0) && finishedReplay != replay) {
            val start = if (runningReplay == replay) animation.progress else 0f
            runningReplay = replay
            animation.animate(loaded, iterations = 1, initialProgress = start, continueFromPreviousAnimate = false)
            finishedReplay = replay
        }
    }
    Box(Modifier.size(96.dp).semantics { contentDescription = text }.onGloballyPositioned {
        val bounds = it.boundsInWindow()
        visible = bounds != Rect.Zero && bounds.width > 0f && bounds.height > 0f
    }) {
        if (composition == null || failed) NativeText(text, fontSize = 96.sp, lineHeight = 104.sp)
        else LottieAnimation(composition, progress = { if (animation.composition == composition) animation.progress else 0f }, modifier = Modifier.size(96.dp))
    }
}
