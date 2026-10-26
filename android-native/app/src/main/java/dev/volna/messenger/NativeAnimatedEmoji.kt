package dev.volna.messenger

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.LottieCompositionFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.zip.GZIPInputStream

internal object NativeAnimatedEmojiCatalog {
    @Volatile private var entries: Map<String, String>? = null
    fun file(context: Context, text: String): String? {
        val index = entries ?: synchronized(this) {
            entries ?: runCatching {
                val rows = JSONObject(context.assets.open("animated-emoji/manifest.json").bufferedReader().use { it.readText() }).getJSONObject("entries")
                rows.keys().asSequence().associateWith { rows.getJSONObject(it).getString("file") }
            }.getOrDefault(emptyMap()).also { entries = it }
        }
        return index[text.trim().replace("\uFE0F", "")]
    }
    fun load(context: Context, file: String): LottieComposition? = runCatching {
        GZIPInputStream(context.assets.open("animated-emoji/$file")).use {
            LottieCompositionFactory.fromJsonInputStreamSync(it, "volna-telegram-$file").value
        }
    }.getOrNull()
}

@Composable
internal fun NativeAnimatedEmoji(text: String, file: String, replay: Int) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val motion = LocalMotionEnabled.current
    var visible by remember(file) { mutableStateOf(false) }
    var foreground by remember(owner) { mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var composition by remember(file) { mutableStateOf<LottieComposition?>(null) }
    var animationView by remember(file) { mutableStateOf<LottieAnimationView?>(null) }
    var startedReplay by remember(file) { mutableIntStateOf(-1) }
    LaunchedEffect(file, visible) {
        if (visible && composition == null) composition = withContext(Dispatchers.IO) { NativeAnimatedEmojiCatalog.load(context, file) }
    }
    LaunchedEffect(animationView, replay, motion, visible, foreground) {
        animationView?.let { view ->
            if (!visible || !foreground || (!motion && replay == 0)) view.pauseAnimation()
            else if (startedReplay != replay) { startedReplay = replay; view.progress = 0f; view.playAnimation() }
            else if (view.progress < 1f && !view.isAnimating) view.resumeAnimation()
        }
    }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, _ -> foreground = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    DisposableEffect(animationView) {
        val view = animationView
        onDispose { view?.cancelAnimation() }
    }
    Box(Modifier.size(128.dp).semantics { contentDescription = "Анимированный эмодзи $text" }.onGloballyPositioned {
        val bounds = it.boundsInWindow()
        visible = bounds.width > 0f && bounds.height > 0f
    }, contentAlignment = Alignment.Center) {
        val value = composition
        if (value == null) NativeText(text, fontSize = 96.sp, lineHeight = 104.sp)
        else AndroidView(factory = { ctx ->
            LottieAnimationView(ctx).apply {
                enableMergePathsForKitKatAndAbove(true)
                setIgnoreDisabledSystemAnimations(true)
                setComposition(value); repeatCount = 0; progress = 0f
                animationView = this
            }
        }, modifier = Modifier.size(128.dp), onRelease = { it.cancelAnimation(); animationView = null })
    }
}
