package dev.volna.messenger

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil.compose.AsyncImage
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import kotlin.math.*

data class NativeWallpaper(val type: String = "solid", val colors: List<Long> = listOf(0xFFEAF2F8),
    val image: String = "", val blur: Int = 0, val dim: Float = 0f, val brightness: Float = 1f,
    val motion: Boolean = false, val pattern: String = "none", val patternColor: Long = 0,
    val patternOpacity: Float = .12f, val animated: Boolean = false) {
    fun json() = JSONObject().put("type", type).put("colors", JSONArray(colors)).put("image", image)
        .put("blur", blur).put("dim", dim).put("brightness", brightness).put("motion", motion)
        .put("pattern", pattern).put("patternColor", patternColor).put("patternOpacity", patternOpacity).put("animated", animated)
    companion object {
        fun parse(o: JSONObject) = NativeWallpaper(
            o.optString("type", "solid").takeIf { it in listOf("solid", "gradient", "image", "pattern") } ?: "solid",
            themeColors(o.optJSONArray("colors"), listOf(0xFFEAF2F8)),
            o.optString("image").takeIf { it.matches(Regex("[a-f0-9-]{36}\\.(jpg|png)")) }.orEmpty(),
            o.optInt("blur").coerceIn(0, 30), finite(o.optDouble("dim"), 0f, 0f, 1f), finite(o.optDouble("brightness", 1.0), 1f, .5f, 1.5f),
            o.optBoolean("motion"), o.optString("pattern", "none").takeIf { it in listOf("none", "dots", "waves", "grid", "orbits") } ?: "none",
            o.optLong("patternColor").takeIf { it == 0L || it in 0xFF000000L..0xFFFFFFFFL } ?: 0L,
            finite(o.optDouble("patternOpacity", .12), .12f, 0f, 1f), o.optBoolean("animated"))
    }
}
data class NativeThemeVariant(val accent: Long = 0xFF3390EC, val surface: Long = 0xFFFFFFFF,
    val secondarySurface: Long = 0xFFE7EDF3, val text: Long = 0xFF17212B, val secondaryText: Long = 0xFF536A7C,
    val outgoing: List<Long> = listOf(0xFFD4E9F8), val incoming: Long = 0xFFFFFFFF,
    val wallpaper: NativeWallpaper = NativeWallpaper()) {
    fun json() = JSONObject().put("accent", accent).put("surface", surface).put("secondarySurface", secondarySurface)
        .put("text", text).put("secondaryText", secondaryText).put("outgoing", JSONArray(outgoing)).put("incoming", incoming).put("wallpaper", wallpaper.json())
    companion object {
        fun parse(o: JSONObject, fallback: NativeThemeVariant) = NativeThemeVariant(themeColor(o, "accent", fallback.accent), themeColor(o, "surface", fallback.surface),
            themeColor(o, "secondarySurface", fallback.secondarySurface), themeColor(o, "text", fallback.text), themeColor(o, "secondaryText", fallback.secondaryText),
            themeColors(o.optJSONArray("outgoing"), fallback.outgoing), themeColor(o, "incoming", fallback.incoming), o.optJSONObject("wallpaper")?.let { NativeWallpaper.parse(it) } ?: fallback.wallpaper)
    }
}
data class NativeTheme(val id: String = UUID.randomUUID().toString(), val name: String = "Моя тема",
    val light: NativeThemeVariant = NativeThemeVariant(), val dark: NativeThemeVariant = NativeThemeVariant(
        accent = 0xFF58B7E8, surface = 0xFF17212B, secondarySurface = 0xFF222F3C, text = 0xFFEDF3F8,
        secondaryText = 0xFF9AABB9, outgoing = listOf(0xFF2B5278), incoming = 0xFF1B2B39,
        wallpaper = NativeWallpaper(colors = listOf(0xFF0E1720))), val radius: Int = 18, val animatedMessages: Boolean = false) {
    fun json() = JSONObject().put("format", "volna-theme").put("version", 1).put("id", id).put("name", name)
        .put("light", light.json()).put("dark", dark.json()).put("radius", radius).put("animatedMessages", animatedMessages)
    companion object {
        fun parse(o: JSONObject): NativeTheme {
            require(o.optString("format") == "volna-theme" && o.optInt("version") == 1) { "Неподдерживаемый файл темы" }
            val defaults = NativeTheme()
            return NativeTheme(o.optString("id").takeIf { it.matches(Regex("[a-zA-Z0-9_-]{1,64}")) || it.matches(Regex("[a-f0-9-]{36}")) } ?: UUID.randomUUID().toString(),
                o.optString("name", "Импортированная тема").filter { it >= ' ' }.take(64).ifBlank { "Импортированная тема" },
                NativeThemeVariant.parse(o.getJSONObject("light"), defaults.light), NativeThemeVariant.parse(o.getJSONObject("dark"), defaults.dark),
                o.optInt("radius", 18).coerceIn(6, 24), o.optBoolean("animatedMessages"))
        }
        fun presets(): List<NativeTheme> {
            val base = NativeTheme(id = "classic", name = "Светлая")
            return listOf(base, base.copy(id = "day", name = "Дневная", light = base.light.copy(accent = 0xFF19A18C, outgoing = listOf(0xFFC8ECDD), wallpaper = NativeWallpaper(colors = listOf(0xFFECF5EA)))),
                base.copy(id = "dark", name = "Тёмная"), base.copy(id = "night", name = "Ночная", dark = base.dark.copy(surface = 0xFF111315, secondarySurface = 0xFF24262A, incoming = 0xFF1C1D20, outgoing = listOf(0xFF45426B), accent = 0xFFB4A2EF, wallpaper = NativeWallpaper(colors = listOf(0xFF08090B)))),
                base.copy(id = "ocean", name = "Океан", light = base.light.copy(outgoing = listOf(0xFFB7E7EA, 0xFFD3D7F6), wallpaper = NativeWallpaper("gradient", listOf(0xFFE2F1F4, 0xFFE9E3F8), pattern = "waves")), dark = base.dark.copy(outgoing = listOf(0xFF255768, 0xFF41436B), wallpaper = NativeWallpaper("gradient", listOf(0xFF0D2432, 0xFF23253C), pattern = "waves"))))
        }
    }
}
private fun themeColor(o: JSONObject, name: String, fallback: Long): Long = o.optLong(name, fallback).takeIf { it in 0xFF000000L..0xFFFFFFFFL } ?: fallback
private fun themeColors(a: JSONArray?, fallback: List<Long>): List<Long> = a?.let { (0 until min(it.length(), 4)).mapNotNull { i -> it.optLong(i).takeIf { c -> c in 0xFF000000L..0xFFFFFFFFL } } }?.takeIf { it.isNotEmpty() } ?: fallback
private fun finite(value: Double, fallback: Float, min: Float, max: Float) = if (value.isFinite()) value.toFloat().coerceIn(min, max) else fallback

internal class NativeThemeStore(private val context: Context, account: Long) {
    private val prefs = context.getSharedPreferences("volna-themes-$account", 0)
    fun themes(): List<NativeTheme> = runCatching { JSONArray(prefs.getString("themes", "[]")).let { a -> (0 until a.length()).map { NativeTheme.parse(a.getJSONObject(it)) } } }.getOrDefault(emptyList())
    fun save(theme: NativeTheme) { val rows = themes().filter { it.id != theme.id } + theme; prefs.edit().putString("themes", JSONArray(rows.takeLast(30).map { it.json() }).toString()).apply() }
    fun remove(id: String) { prefs.edit().putString("themes", JSONArray(themes().filter { it.id != id }.map { it.json() }).toString()).apply() }
    fun chat(id: Long): NativeTheme? = runCatching { prefs.getString("chat:$id", null)?.let { NativeTheme.parse(JSONObject(it)) } }.getOrNull()
    fun setChat(id: Long, theme: NativeTheme?) { prefs.edit().apply { if (theme == null) remove("chat:$id") else putString("chat:$id", theme.json().toString()) }.apply() }
    fun export(theme: NativeTheme): String {
        val objectValue = theme.json()
        for (key in listOf("light", "dark")) {
            val wallpaper = objectValue.getJSONObject(key).getJSONObject("wallpaper")
            val file = File(context.filesDir, "theme-wallpapers/" + wallpaper.optString("image"))
            if (file.isFile && file.length() <= 4 * 1024 * 1024) wallpaper.put("imageData", android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP))
            wallpaper.put("image", "")
        }
        return objectValue.toString(2)
    }
    fun importTheme(text: String): NativeTheme {
        require(text.toByteArray().size <= 12 * 1024 * 1024) { "Файл темы больше 12 МБ" }
        val objectValue = JSONObject(text); NativeTheme.parse(objectValue)
        for (key in listOf("light", "dark")) {
            val wallpaper = objectValue.getJSONObject(key).getJSONObject("wallpaper")
            val encoded = wallpaper.optString("imageData")
            wallpaper.put("image", "") // Imported JSON cannot point to an existing private file.
            if (encoded.isNotBlank()) {
                require(encoded.length <= 6 * 1024 * 1024) { "Изображение темы слишком большое" }
                val bytes = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT)
                require(bytes.size <= 4 * 1024 * 1024) { "Изображение темы больше 4 МБ" }
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                require(options.outWidth in 1..4096 && options.outHeight in 1..4096) { "Некорректное изображение темы" }
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalArgumentException("Не удалось открыть изображение темы")
                val name = UUID.randomUUID().toString() + ".jpg"; val directory = File(context.filesDir, "theme-wallpapers").apply { mkdirs() }
                File(directory, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }; bitmap.recycle(); wallpaper.put("image", name)
            }
        }
        return NativeTheme.parse(objectValue).copy(id = UUID.randomUUID().toString())
    }
}

internal val LocalThemeVariant = staticCompositionLocalOf { NativeThemeVariant() }
internal val LocalNativeBackdrop = staticCompositionLocalOf<HazeState?> { null }

@Composable
internal fun NativeGlassSurface(modifier: Modifier = Modifier, radius: Dp = 22.dp, backgroundOnly: Boolean = false, floating: Boolean = false, content: @Composable () -> Unit) {
    val settings = LocalNativeAppearance.current; val state = LocalNativeBackdrop.current
    val blur = settings.glass && settings.blurMode != "off" && settings.quality != "economy" && !settings.powerSaving && LocalMotionEnabled.current && android.os.Build.VERSION.SDK_INT >= 31 && state != null
    val shape = RoundedCornerShape(radius)
    val color = Panel
    val opacity = if (floating) .42f else settings.glassOpacity
    val style = HazeStyle(backgroundColor = if (floating) Color.Transparent else color, tints = listOf(HazeTint(color.copy(alpha = opacity))),
        blurRadius = (if (settings.blurMode == "simple" || settings.quality == "balanced") settings.blurIntensity.coerceAtMost(12) else settings.blurIntensity).dp,
        noiseFactor = 0f, fallbackTint = HazeTint(color.copy(alpha = if (floating) opacity else .94f)))
    Box(modifier.shadow(if (settings.glass && !floating) 4.dp else 0.dp, shape).graphicsLayer { this.shape = shape; clip = true; compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }.clip(shape)
        .then(if (blur) Modifier.hazeEffect(state = state!!, style = style) {
            if (backgroundOnly) canDrawArea = { area -> area.key != "home-content" }
        } else Modifier.background(if (floating) color.copy(alpha = opacity) else if (settings.glass && settings.quality != "economy") color.copy(alpha = settings.glassOpacity.coerceAtLeast(.88f)) else color))
        .border(1.dp, TextMain.copy(alpha = if (settings.glass) .09f else .03f), shape)) { content() }
}

internal fun nativeContrast(a: Color, b: Color): Float { val x = a.luminance(); val y = b.luminance(); return (max(x, y) + .05f) / (min(x, y) + .05f) }
internal fun nativeReadableText(backgrounds: List<Color>): Color = listOf(Color(0xFF101820), Color.White).maxBy { text -> backgrounds.minOf { nativeContrast(text, it) } }
internal fun nativeReadableAccent(accent: Color, surface: Color): Color {
    var result = accent
    val text = nativeReadableText(listOf(surface))
    var attempts = 0
    while (nativeContrast(result, surface) < 3f && attempts++ < 20) result = lerp(result, text, .12f)
    return result
}
internal fun nativeReadableStops(colors: List<Color>): List<Color> {
    val text = nativeReadableText(colors)
    return colors.map { original -> var color = original; var count = 0; while (nativeContrast(text, color) < 4.5f && count++ < 15) color = lerp(color, if (text == Color.White) Color.Black else Color.White, .12f); color }
}

@Composable
internal fun nativeMessageBrush(isMine: Boolean): Brush {
    val variant = LocalThemeVariant.current; val appearance = LocalNativeAppearance.current
    val raw = if (!isMine) listOf(Incoming) else if (appearance.design != null) variant.outgoing.map { Color(it.toInt()) } else listOf(Outgoing)
    val colors = nativeReadableStops(raw)
    val active = LocalMotionEnabled.current && appearance.quality == "max" && appearance.design?.animatedMessages == true && isMine && colors.size > 1 && nativeScreenActive()
    val progress = if (active) { val transition = rememberInfiniteTransition(label = "message-gradient"); val value by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(12000, easing = LinearEasing), RepeatMode.Reverse), label = "message-gradient-progress"); value } else 0f
    return if (colors.size == 1) Brush.linearGradient(listOf(colors.first(), colors.first())) else Brush.linearGradient(colors, start = Offset(progress * 300, 0f), end = Offset(700f, 300f + progress * 300))
}

@Composable
internal fun NativeWallpaperView(wallpaper: NativeWallpaper, modifier: Modifier = Modifier, scroll: Float = 0f) {
    val context = LocalContext.current; val appearance = LocalNativeAppearance.current
    val active = LocalMotionEnabled.current && !appearance.powerSaving && appearance.quality != "economy" && nativeScreenActive()
    val colors = wallpaper.colors.map { Color(it.toInt()) }
    val progress = if (wallpaper.animated && active) { val transition = rememberInfiniteTransition(label = "wallpaper"); val p by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(24000, easing = LinearEasing), RepeatMode.Reverse), label = "wallpaper-progress"); p } else 0f
    Box(modifier.clip(RoundedCornerShape(0.dp)).background(if (colors.size > 1) Brush.linearGradient(colors, start = Offset(progress * 500, 0f), end = Offset(800f, 1200f + progress * 400)) else Brush.linearGradient(listOf(colors.first(), colors.first())))) {
        if (wallpaper.type == "image" && wallpaper.image.isNotBlank()) {
            val file = File(context.filesDir, "theme-wallpapers/${wallpaper.image}")
            AsyncImage(file, null, Modifier.matchParentSize().graphicsLayer {
                if (wallpaper.motion && active) { scaleX = 1.04f; scaleY = 1.04f; translationY = (scroll % 24f - 12f).coerceIn(-12f, 12f) }
            }.then(if (wallpaper.blur > 0 && appearance.quality != "economy") Modifier.blur(wallpaper.blur.dp) else Modifier), contentScale = ContentScale.Crop)
            if (wallpaper.brightness < 1f) Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 1 - wallpaper.brightness)))
            if (wallpaper.brightness > 1f) Box(Modifier.matchParentSize().background(Color.White.copy(alpha = (wallpaper.brightness - 1) / 2)))
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = wallpaper.dim)))
        }
        if (wallpaper.pattern != "none" && wallpaper.patternOpacity > 0) {
            val color = (if (wallpaper.patternColor == 0L) nativeReadableText(colors) else Color(wallpaper.patternColor.toInt())).copy(alpha = wallpaper.patternOpacity * .45f)
            Canvas(Modifier.matchParentSize()) {
                val step = 44.dp.toPx(); val xCount = (size.width / step).toInt() + 1; val yCount = (size.height / step).toInt() + 1
                for (x in 0..xCount) for (y in 0..yCount) { val point = Offset(x * step + if (y % 2 == 0) 0f else step / 2, y * step)
                    when (wallpaper.pattern) {
                        "dots" -> drawCircle(color, 2.dp.toPx(), point)
                        "grid" -> { drawLine(color, point, point + Offset(step, 0f), 1.dp.toPx()); drawLine(color, point, point + Offset(0f, step), 1.dp.toPx()) }
                        "orbits" -> drawCircle(color, 9.dp.toPx(), point, style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                        "waves" -> drawArc(color, 0f, 180f, false, point, androidx.compose.ui.geometry.Size(step, step / 2), style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()))
                    }
                }
            }
        }
    }
}

@Composable
internal fun nativeScreenActive(): Boolean {
    val context = LocalContext.current; val owner = context as? androidx.lifecycle.LifecycleOwner
    var active by remember(owner) { mutableStateOf(owner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) ?: true) }
    DisposableEffect(owner) { val observer = LifecycleEventObserver { _, _ -> active = owner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) ?: true }; owner?.lifecycle?.addObserver(observer); onDispose { owner?.lifecycle?.removeObserver(observer) } }
    return active
}

@Composable
internal fun NativeImageCropEditor(uri: Uri, title: String, onDismiss: () -> Unit, aspect: Float = 1f, onDone: (File) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }; var scale by remember { mutableStateOf(1f) }; var pan by remember { mutableStateOf(Offset.Zero) }
    var error by remember { mutableStateOf("") }; var saving by remember { mutableStateOf(false) }; var viewport by remember { mutableStateOf(Size(1f, 1f)) }
    LaunchedEffect(uri) {
        try { bitmap = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            if (android.os.Build.VERSION.SDK_INT >= 28) android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ -> decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE; val max = max(info.size.width, info.size.height); if (max > 2048) decoder.setTargetSize(info.size.width * 2048 / max, info.size.height * 2048 / max) }
            else { val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }; context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }; options.inJustDecodeBounds = false; options.inSampleSize = (max(options.outWidth, options.outHeight) / 2048).coerceAtLeast(1); context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } }
        } ?: throw IllegalArgumentException("Изображение недоступно") }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть изображение" }
    }
    DisposableEffect(bitmap) { onDispose { bitmap?.recycle() } }
    NativeFullScreen(title, { if (!saving) onDismiss() }) { Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
        val width = min(maxWidth.value, maxHeight.value * aspect).dp
        Box(Modifier.width(width).aspectRatio(aspect).clip(RoundedCornerShape(20.dp)).background(Input).onSizeChangedForCrop { viewport = it }) {
            bitmap?.let { image -> Image(image.asImageBitmap(), null, Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = pan.x; translationY = pan.y }.pointerInput(image) { detectTransformGestures { _, delta, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 4f); val base = max(viewport.width / image.width, viewport.height / image.height); val x = max(0f, (image.width * base * scale - viewport.width) / 2); val y = max(0f, (image.height * base * scale - viewport.height) / 2); pan = Offset((pan.x + delta.x).coerceIn(-x, x), (pan.y + delta.y).coerceIn(-y, y)) } }, contentScale = ContentScale.Crop) }
        } }
        NativeText("Перемещайте изображение и меняйте масштаб двумя пальцами", color = Muted)
        Slider(scale, { scale = it; pan = Offset.Zero }, valueRange = 1f..4f)
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        Button(enabled = bitmap != null && !saving, onClick = { val image = bitmap ?: return@Button; saving = true; scope.launch {
            try { val file = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                val factor = max(viewport.width / image.width, viewport.height / image.height) * scale
                val cropWidth = (viewport.width / factor).toInt().coerceIn(1, image.width); val cropHeight = (viewport.height / factor).toInt().coerceIn(1, image.height)
                val x = ((image.width - cropWidth) / 2f - pan.x / factor).toInt().coerceIn(0, image.width - cropWidth); val y = ((image.height - cropHeight) / 2f - pan.y / factor).toInt().coerceIn(0, image.height - cropHeight)
                val cropped = Bitmap.createBitmap(image, x, y, cropWidth, cropHeight); val directory = File(context.cacheDir, "attachments/theme-editor").apply { mkdirs() }; val output = File(directory, UUID.randomUUID().toString() + ".png")
                output.outputStream().use { cropped.compress(Bitmap.CompressFormat.PNG, 100, it) }; if (cropped !== image) cropped.recycle(); output
            }; onDone(file) }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось сохранить изображение" } finally { saving = false }
        } }) { NativeText(if (saving) "Сохраняю…" else "Использовать изображение") }
    } }
}
private fun Modifier.onSizeChangedForCrop(onSize: (Size) -> Unit): Modifier = this.then(Modifier.onSizeChanged { onSize(Size(it.width.toFloat(), it.height.toFloat())) })
