package dev.volna.messenger

import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

data class NativeAppearance(
    val theme: String = "system", val textScale: Float = 1f, val font: String = "system",
    val density: String = "standard", val radius: Int = 16, val accent: Long = 0xFF58B7E8,
    val avatars: Boolean = false, val timeOnTap: Boolean = false,
    val background: String = "plain", val outgoing: Long = 0, val uiScale: Float = 1f,
    val animations: Boolean = true, val powerSaving: Boolean = false,
    val design: NativeTheme? = null, val glass: Boolean = false, val glassOpacity: Float = .78f,
    val blurMode: String = "simple", val blurIntensity: Int = 18, val quality: String = "balanced",
    val nightStart: Int = 22 * 60, val nightEnd: Int = 7 * 60
) {
    val spacing: Int get() = when (density) { "minimal" -> 1; "compact" -> 3; "large" -> 9; else -> 5 }
    val padding: Int get() = when (density) { "minimal" -> 3; "compact" -> 5; "large" -> 12; else -> 8 }
    fun save(prefs: SharedPreferences) {
        prefs.edit().putString("theme", theme).putFloat("textScale", textScale).putString("font", font)
            .putString("density", density).putInt("radius", radius).putLong("accent", accent)
            .putBoolean("avatars", avatars).putBoolean("timeOnTap", timeOnTap)
            .putString("background", background).putLong("outgoing", outgoing).putFloat("uiScale", uiScale)
            .putBoolean("animations", animations).putBoolean("powerSaving", powerSaving)
            .putString("design", design?.json()?.toString()).putBoolean("glass", glass).putFloat("glassOpacity", glassOpacity)
            .putString("blurMode", blurMode).putInt("blurIntensity", blurIntensity).putString("quality", quality)
            .putInt("nightStart", nightStart).putInt("nightEnd", nightEnd).apply()
    }
    companion object {
        fun load(prefs: SharedPreferences) = NativeAppearance(
            theme = prefs.getString("theme", "system").takeIf { it in listOf("system", "light", "dark", "schedule") } ?: "system",
            textScale = prefs.getFloat("textScale", 1f).takeIf { it.isFinite() }?.coerceIn(0.75f, 1.60f) ?: 1f,
            font = prefs.getString("font", "system").takeIf { it in listOf("system", "neutral", "serif", "condensed", "mono") } ?: "system",
            density = prefs.getString("density", "standard").takeIf { it in listOf("minimal", "compact", "standard", "large") } ?: "standard",
            radius = prefs.getInt("radius", 16).coerceIn(0, 30), accent = prefs.getLong("accent", 0xFF58B7E8),
            avatars = prefs.getBoolean("avatars", false), timeOnTap = prefs.getBoolean("timeOnTap", false),
            background = prefs.getString("background", "plain").takeIf { it in listOf("plain", "blue", "mint", "violet") } ?: "plain",
            outgoing = prefs.getLong("outgoing", 0), uiScale = prefs.getFloat("uiScale", 1f).takeIf { it.isFinite() }?.coerceIn(0.9f, 1.15f) ?: 1f,
            animations = prefs.getBoolean("animations", true), powerSaving = prefs.getBoolean("powerSaving", false),
            design = runCatching { prefs.getString("design", null)?.let { NativeTheme.parse(org.json.JSONObject(it)) } }.getOrNull(),
            glass = prefs.getBoolean("glass", false), glassOpacity = prefs.getFloat("glassOpacity", .78f).takeIf { it.isFinite() }?.coerceIn(.65f, 1f) ?: .78f,
            blurMode = prefs.getString("blurMode", "simple").takeIf { it in listOf("full", "simple", "off") } ?: "simple",
            blurIntensity = prefs.getInt("blurIntensity", 18).coerceIn(0, 30), quality = prefs.getString("quality", "balanced").takeIf { it in listOf("max", "balanced", "economy") } ?: "balanced",
            nightStart = prefs.getInt("nightStart", 1320).coerceIn(0, 1439), nightEnd = prefs.getInt("nightEnd", 420).coerceIn(0, 1439)
        )
    }
}

data class VolnaPalette(val ink: Color, val panel: Color, val input: Color, val hover: Color,
    val text: Color, val muted: Color, val accent: Color, val outgoing: Color, val incoming: Color)

val LocalNativeAppearance = staticCompositionLocalOf { NativeAppearance() }
internal val LocalMotionEnabled = staticCompositionLocalOf { true }
private val LocalNativeBaseDensity = staticCompositionLocalOf<Density?> { null }
internal val LocalVolnaPalette = staticCompositionLocalOf {
    VolnaPalette(Color(0xFF0E1823), Color(0xFF1E2B39), Color(0xFF273746), Color(0xFF2D4053), Color(0xFFEDF3F8),
        Color(0xFF8295A7), Color(0xFF58B7E8), Color(0xFF2B5278), Color(0xFF1B2B39))
}
internal val Ink: Color @Composable get() = LocalVolnaPalette.current.ink
internal val Panel: Color @Composable get() = LocalVolnaPalette.current.panel
internal val Input: Color @Composable get() = LocalVolnaPalette.current.input
internal val Hover: Color @Composable get() = LocalVolnaPalette.current.hover
internal val TextMain: Color @Composable get() = LocalVolnaPalette.current.text
internal val Muted: Color @Composable get() = LocalVolnaPalette.current.muted
internal val Accent: Color @Composable get() = LocalVolnaPalette.current.accent
internal val AccentText: Color @Composable get() {
    val light = Color.White; val dark = Color(0xFF0E1720); val luminosity = Accent.luminance()
    return if ((luminosity + 0.05f) / (dark.luminance() + 0.05f) >= (light.luminance() + 0.05f) / (luminosity + 0.05f)) dark else light
}
internal val Outgoing: Color @Composable get() = LocalVolnaPalette.current.outgoing
internal val Incoming: Color @Composable get() = LocalVolnaPalette.current.incoming
internal val ChatBackground: Color @Composable get() = when (LocalNativeAppearance.current.background) {
    "blue" -> lerp(Ink, Color(0xFF58B7E8), .12f)
    "mint" -> lerp(Ink, Color(0xFF5BBF9A), .12f)
    "violet" -> lerp(Ink, Color(0xFF7987EE), .12f)
    else -> Ink
}

@Composable
fun VolnaTheme(appearance: NativeAppearance, updateSystemBars: Boolean = true, content: @Composable () -> Unit) {
    var time by remember { mutableStateOf(java.time.LocalTime.now()) }
    LaunchedEffect(appearance.theme) { if (appearance.theme == "schedule") while (true) { time = java.time.LocalTime.now(); kotlinx.coroutines.delay(30000) } }
    val dark = appearance.theme == "dark" || appearance.theme == "system" && isSystemInDarkTheme() || appearance.theme == "schedule" && nativeNightAt(time.hour * 60 + time.minute, appearance.nightStart, appearance.nightEnd)
    val variant = appearance.design?.let { if (dark) it.dark else it.light }
    val systemMotion = nativeSystemMotionEnabled()
    val accent = Color((variant?.accent ?: appearance.accent).toInt())
    val outgoingAccent = if (appearance.outgoing == 0L) accent else Color(appearance.outgoing.toInt())
    val defaultPalette = if (dark) VolnaPalette(Color(0xFF0E1823), Color(0xFF1E2B39), Color(0xFF273746), Color(0xFF2D4053),
        Color(0xFFEDF3F8), Color(0xFF9AABB9), accent, if (appearance.outgoing == 0L) Color(0xFF3C6087) else lerp(Color(0xFF1E2B39), outgoingAccent, 0.28f), Color(0xFF1E2B39))
    else VolnaPalette(Color(0xFFF0F4F8), Color.White, Color(0xFFE7EDF3), Color(0xFFDCE8F0), Color(0xFF17212B),
        Color(0xFF536A7C), lerp(accent, Color(0xFF153F62), 0.25f), lerp(Color.White, outgoingAccent, 0.23f), Color.White)
    val rawTarget = if (variant == null) defaultPalette else VolnaPalette(Color(variant.wallpaper.colors.first().toInt()), Color(variant.surface.toInt()), Color(variant.secondarySurface.toInt()),
        lerp(Color(variant.surface.toInt()), accent, .12f), nativeReadableText(listOf(Color(variant.surface.toInt()))),
        nativeReadableText(listOf(Color(variant.surface.toInt()))).copy(alpha = .68f), accent, Color(variant.outgoing.first().toInt()), Color(variant.incoming.toInt()))
    val target = rawTarget.copy(accent = nativeReadableAccent(rawTarget.accent, rawTarget.panel))
    val motion = appearance.animations && !appearance.powerSaving && systemMotion && appearance.quality != "economy"
    @Composable fun smooth(color: Color, label: String): Color { val value by androidx.compose.animation.animateColorAsState(color, androidx.compose.animation.core.tween(if (motion) 200 else 0), label = label); return value }
    val palette = target.copy(ink = smooth(target.ink, "ink"), panel = smooth(target.panel, "panel"), input = smooth(target.input, "input"), hover = smooth(target.hover, "hover"), text = smooth(target.text, "text"), muted = smooth(target.muted, "muted"), accent = smooth(target.accent, "accent"), outgoing = smooth(target.outgoing, "outgoing"), incoming = smooth(target.incoming, "incoming"))
    val scheme = if (dark) darkColorScheme(primary = palette.accent, onPrimary = nativeReadableText(listOf(palette.accent)), background = palette.ink,
        onBackground = palette.text, surface = palette.panel, onSurface = palette.text, secondary = palette.accent,
        surfaceVariant = palette.input, onSurfaceVariant = palette.muted, secondaryContainer = palette.hover, onSecondaryContainer = palette.text)
    else lightColorScheme(primary = palette.accent, onPrimary = nativeReadableText(listOf(palette.accent)), background = palette.ink, onBackground = palette.text,
        surface = palette.panel, onSurface = palette.text, secondary = palette.accent,
        surfaceVariant = palette.input, onSurfaceVariant = palette.muted, secondaryContainer = palette.hover, onSecondaryContainer = palette.text)
    val family = remember(appearance.font) { nativeAppearanceFont(appearance.font) }
    val typography = Typography().let { it.copy(
        bodyLarge = it.bodyLarge.copy(fontFamily = family), bodyMedium = it.bodyMedium.copy(fontFamily = family), bodySmall = it.bodySmall.copy(fontFamily = family),
        titleLarge = it.titleLarge.copy(fontFamily = family), titleMedium = it.titleMedium.copy(fontFamily = family), titleSmall = it.titleSmall.copy(fontFamily = family),
        displayLarge = it.displayLarge.copy(fontFamily = family), displayMedium = it.displayMedium.copy(fontFamily = family), displaySmall = it.displaySmall.copy(fontFamily = family),
        headlineLarge = it.headlineLarge.copy(fontFamily = family), headlineMedium = it.headlineMedium.copy(fontFamily = family), headlineSmall = it.headlineSmall.copy(fontFamily = family),
        labelLarge = it.labelLarge.copy(fontFamily = family), labelMedium = it.labelMedium.copy(fontFamily = family), labelSmall = it.labelSmall.copy(fontFamily = family)) }
    val density = LocalNativeBaseDensity.current ?: LocalDensity.current
    val activity = LocalContext.current as? android.app.Activity
    SideEffect { if (updateSystemBars) activity?.window?.let { window ->
        window.statusBarColor = palette.ink.toArgb(); window.navigationBarColor = palette.ink.toArgb()
        WindowInsetsControllerCompat(window, window.decorView).apply { isAppearanceLightStatusBars = palette.ink.luminance() > .5f; isAppearanceLightNavigationBars = palette.ink.luminance() > .5f }
    } }
    CompositionLocalProvider(LocalNativeAppearance provides appearance, LocalVolnaPalette provides palette,
        LocalMotionEnabled provides motion, LocalThemeVariant provides (variant ?: if (dark) NativeTheme().dark else NativeTheme().light),
        LocalNativeBaseDensity provides density,
        LocalDensity provides Density(density.density * appearance.uiScale, density.fontScale * appearance.textScale)) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

@Composable
fun AppearanceDialog(value: NativeAppearance, onChange: (NativeAppearance) -> Unit, onDismiss: () -> Unit, account: Long = 0, chat: Long? = null, onResetChat: (() -> Unit)? = null) {
    NativeAppearanceEditor(value, onChange, onDismiss, account, chat, onResetChat)
}

internal fun nativeNightAt(minute: Int, start: Int, end: Int): Boolean = if (start == end) true else if (start < end) minute in start until end else minute >= start || minute < end

@Composable
internal fun NativeMessageContent(isMine: Boolean, content: @Composable () -> Unit) {
    val palette = LocalVolnaPalette.current
    val appearance = LocalNativeAppearance.current
    val colors = if (!isMine) listOf(Incoming) else if (appearance.design != null) LocalThemeVariant.current.outgoing.map { Color(it.toInt()) } else listOf(Outgoing)
    val stops = nativeReadableStops(colors)
    val text = nativeReadableText(stops)
    var link = palette.accent
    var count = 0
    while (stops.minOf { nativeContrast(link, it) } < 3f && count++ < 10) link = lerp(link, text, .18f)
    CompositionLocalProvider(LocalVolnaPalette provides palette.copy(text = text, muted = text.copy(alpha = .68f), accent = link), content = content)
}

@Composable
private fun nativeSystemMotionEnabled(): Boolean {
    val context = LocalContext.current
    fun enabled() = android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0 && !(context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager).isPowerSaveMode
    var value by remember { mutableStateOf(enabled()) }
    DisposableEffect(context) {
        val observer = object : android.database.ContentObserver(android.os.Handler(android.os.Looper.getMainLooper())) { override fun onChange(selfChange: Boolean) { value = enabled() } }
        val receiver = object : android.content.BroadcastReceiver() { override fun onReceive(context: android.content.Context, intent: android.content.Intent) { value = enabled() } }
        context.contentResolver.registerContentObserver(android.provider.Settings.Global.getUriFor(android.provider.Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        val filter = android.content.IntentFilter(android.os.PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        if (android.os.Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED) else context.registerReceiver(receiver, filter)
        onDispose { context.contentResolver.unregisterContentObserver(observer); context.unregisterReceiver(receiver) }
    }
    return value
}

@Composable
internal fun AppearanceChoices(title: String, values: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    NativeText(title, color = Muted, fontSize = 13.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        values.forEach { (key, label) ->
            NativeText(label, Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (key == selected) Hover else Panel)
                .clickable { onSelect(key) }.padding(horizontal = 4.dp, vertical = 10.dp), color = if (key == selected) Accent else TextMain, fontSize = 11.sp)
        }
    }
}

internal fun nativeAppearanceFont(key: String): FontFamily = when (key) {
    "serif" -> FontFamily.Serif
    "condensed" -> FontFamily(android.graphics.Typeface.create("sans-serif-condensed", android.graphics.Typeface.NORMAL))
    "mono" -> FontFamily.Monospace
    "neutral" -> FontFamily.SansSerif
    else -> FontFamily.Default
}
