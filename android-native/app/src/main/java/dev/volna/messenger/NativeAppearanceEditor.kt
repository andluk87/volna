@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package dev.volna.messenger

import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.*
import androidx.core.content.FileProvider
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.*
import java.io.File
import java.util.UUID
import kotlin.math.*

@Composable
internal fun NativeAppearanceEditor(value: NativeAppearance, onChange: (NativeAppearance) -> Unit, onDismiss: () -> Unit,
    account: Long, chat: Long?, onResetChat: (() -> Unit)?) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val store = remember(account) { NativeThemeStore(context, account) }
    val design = value.design ?: remember(value.accent, value.outgoing, value.radius, value.background) {
        val default = NativeTheme(id = "current", name = "Моя тема", radius = value.radius.coerceIn(6, 24))
        default.copy(light = default.light.copy(accent = value.accent, outgoing = listOf(if (value.outgoing == 0L) 0xFFD4E9F8 else value.outgoing)), dark = default.dark.copy(accent = value.accent, outgoing = listOf(if (value.outgoing == 0L) 0xFF2B5278 else value.outgoing)))
    }
    var night by remember { mutableStateOf(false) }
    val variant = if (night) design.dark else design.light
    var themes by remember(account) { mutableStateOf(store.themes()) }
    var naming by remember { mutableStateOf(false) }; var name by remember { mutableStateOf(design.name) }
    var importing by remember { mutableStateOf<NativeTheme?>(null) }; var crop by remember { mutableStateOf<Uri?>(null) }
    var status by remember { mutableStateOf("") }; var colorTarget by remember { mutableStateOf<String?>(null) }
    fun updateVariant(updated: NativeThemeVariant) { onChange(value.copy(design = if (night) design.copy(dark = updated) else design.copy(light = updated))) }
    fun wallpaper(updated: NativeWallpaper) { updateVariant(variant.copy(wallpaper = updated)) }
    fun apply(theme: NativeTheme) { onChange(value.copy(design = theme, radius = theme.radius)); status = "Тема применена" }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) crop = uri }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch { try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { it.write(store.export(design)) } ?: throw IllegalStateException("Файл недоступен") }; status = "Тема экспортирована" } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { status = problem.message ?: "Не удалось экспортировать тему" } }
    }
    val importTheme = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { try { importing = withContext(Dispatchers.IO) { val bytes = context.contentResolver.openInputStream(uri)?.use { input -> val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(16384); while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 12 * 1024 * 1024) { "Файл темы больше 12 МБ" }; output.write(buffer, 0, count) }; output.toString("UTF-8") } ?: throw IllegalStateException("Файл недоступен"); store.importTheme(bytes) } } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { status = problem.message ?: "Не удалось импортировать тему" } }
    }
    NativeFullScreen(if (chat == null) "Оформление" else "Оформление чата", onDismiss) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeThemePreview(value.copy(design = design, theme = if (night) "dark" else "light"))
            if (status.isNotBlank()) NativeText(status, color = Accent, fontSize = 13.sp)
            if (chat == null) {
                AppearanceChoices("Тема интерфейса", listOf("system" to "В системе", "light" to "Светлая", "dark" to "Тёмная", "schedule" to "По времени"), value.theme) { onChange(value.copy(theme = it)) }
                if (value.theme == "schedule") Row {
                    TextButton(onClick = { TimePickerDialog(context, { _, h, m -> onChange(value.copy(nightStart = h * 60 + m)) }, value.nightStart / 60, value.nightStart % 60, true).show() }, Modifier.weight(1f)) { NativeText("Ночь с ${nativeTimeLabel(value.nightStart)}") }
                    TextButton(onClick = { TimePickerDialog(context, { _, h, m -> onChange(value.copy(nightEnd = h * 60 + m)) }, value.nightEnd / 60, value.nightEnd % 60, true).show() }, Modifier.weight(1f)) { NativeText("До ${nativeTimeLabel(value.nightEnd)}") }
                }
            }
            AppearanceChoices("Редактируемый вариант", listOf("day" to "День", "night" to "Ночь"), if (night) "night" else "day") { night = it == "night" }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(NativeTheme.presets(), key = { it.id }) { preset -> Column(Modifier.width(100.dp).clip(RoundedCornerShape(18.dp)).background(Panel).clickable {
                    onChange(value.copy(design = preset, radius = preset.radius, theme = when (preset.id) { "dark", "night" -> "dark"; "classic", "day" -> "light"; else -> value.theme })); night = preset.id in listOf("dark", "night")
                }.padding(10.dp)) { Box(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient((if (preset.id in listOf("dark", "night")) preset.dark else preset.light).outgoing.map { Color(it.toInt()) }.let { if (it.size == 1) it + it else it }))); NativeText(preset.name, color = TextMain, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) } }
            }
            NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                NativeText("Акцентный цвет", color = Muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(0xFF3390EC, 0xFF7C6DEA, 0xFF19A18C, 0xFFE16E43, 0xFFCB557C, 0xFFE6A329).forEach { color -> ColorDot(color, variant.accent == color) { updateVariant(variant.copy(accent = color)) } }; IconButton(onClick = { colorTarget = "accent" }) { Icon(Icons.Outlined.Palette, "Выбрать свой акцентный цвет") } }
                NativeText("Исходящие сообщения · до четырёх цветов", color = Muted, fontSize = 13.sp)
                NativeGradientEditor(variant.outgoing) { updateVariant(variant.copy(outgoing = it)) }
                Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Анимированный градиент", Modifier.weight(1f)); Switch(design.animatedMessages, { onChange(value.copy(design = design.copy(animatedMessages = it))) }) }
                NativeSettingRow(Icons.Outlined.ChatBubbleOutline, "Входящие сообщения", "Свой цвет") { colorTarget = "incoming" }
                NativeText("Скругление · ${value.radius} dp", color = Muted)
                Slider(value.radius.toFloat().coerceIn(6f, 24f), { onChange(value.copy(radius = it.toInt(), design = design.copy(radius = it.toInt()))) }, valueRange = 6f..24f)
                val raw = variant.outgoing.map { Color(it.toInt()) }
                if (raw.minOf { nativeContrast(nativeReadableText(raw), it) } < 4.5f) NativeText("Некоторые элементы могут быть плохо видны. Цвета сообщений автоматически корректируются для читаемости.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            } }
            NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AppearanceChoices("Фон чата", listOf("solid" to "Цвет", "gradient" to "Градиент", "image" to "Фото", "pattern" to "Узор"), variant.wallpaper.type) { type ->
                    if (type == "image") imagePicker.launch(arrayOf("image/*")) else wallpaper(variant.wallpaper.copy(type = type, colors = if (type == "gradient" && variant.wallpaper.colors.size == 1) variant.wallpaper.colors + if (night) 0xFF313058 else 0xFFE2DFF3 else variant.wallpaper.colors, pattern = if (type == "pattern" && variant.wallpaper.pattern == "none") "dots" else variant.wallpaper.pattern))
                }
                if (variant.wallpaper.type == "image") {
                    TextButton(onClick = { imagePicker.launch(arrayOf("image/*")) }) { NativeText("Выбрать другое изображение") }
                    NativeText("Размытие фотографии · ${variant.wallpaper.blur}", color = Muted)
                    Slider(variant.wallpaper.blur.toFloat(), { wallpaper(variant.wallpaper.copy(blur = it.toInt())) }, valueRange = 0f..30f)
                    NativeText("Затемнение · ${(variant.wallpaper.dim * 100).toInt()}%", color = Muted)
                    Slider(variant.wallpaper.dim, { wallpaper(variant.wallpaper.copy(dim = it)) })
                    NativeText("Яркость", color = Muted); Slider(variant.wallpaper.brightness, { wallpaper(variant.wallpaper.copy(brightness = it)) }, valueRange = .5f..1.5f)
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Движение фона", Modifier.weight(1f)); Switch(variant.wallpaper.motion, { wallpaper(variant.wallpaper.copy(motion = it)) }) }
                } else {
                    NativeGradientEditor(variant.wallpaper.colors, max = if (variant.wallpaper.type == "solid") 1 else 4) { wallpaper(variant.wallpaper.copy(colors = it)) }
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Анимированный фон", Modifier.weight(1f)); Switch(variant.wallpaper.animated, { wallpaper(variant.wallpaper.copy(animated = it)) }, enabled = variant.wallpaper.colors.size > 1) }
                }
                AppearanceChoices("Паттерн", listOf("none" to "Нет", "dots" to "Точки", "waves" to "Волны", "grid" to "Сетка", "orbits" to "Орбиты"), variant.wallpaper.pattern) { wallpaper(variant.wallpaper.copy(pattern = it)) }
                if (variant.wallpaper.pattern != "none") { NativeText("Интенсивность узора · ${(variant.wallpaper.patternOpacity * 100).toInt()}%", color = Muted); Slider(variant.wallpaper.patternOpacity, { wallpaper(variant.wallpaper.copy(patternOpacity = it)) }); TextButton(onClick = { colorTarget = "pattern" }) { NativeText("Цвет узора") }; TextButton(onClick = { wallpaper(variant.wallpaper.copy(patternColor = 0L)) }) { NativeText("Автоматический цвет") } }
            } }
            if (chat == null) {
                NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AppearanceChoices("Качество эффектов", listOf("max" to "Максимум", "balanced" to "Баланс", "economy" to "Экономия"), value.quality) { onChange(value.copy(quality = it)) }
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Стеклянные панели", Modifier.weight(1f)); Switch(value.glass, { onChange(value.copy(glass = it)) }) }
                    AppearanceChoices("Размытие поверхностей", listOf("full" to "Полное", "simple" to "Упрощённое", "off" to "Отключено"), value.blurMode) { onChange(value.copy(blurMode = it)) }
                    NativeText("Плотность стекла · ${(value.glassOpacity * 100).toInt()}%", color = Muted)
                    Slider(value.glassOpacity, { onChange(value.copy(glassOpacity = it)) }, valueRange = .65f..1f)
                    NativeText("Сила blur · ${value.blurIntensity}", color = Muted); Slider(value.blurIntensity.toFloat(), { onChange(value.copy(blurIntensity = it.toInt())) }, valueRange = 0f..30f)
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Анимации", Modifier.weight(1f)); Switch(value.animations, { onChange(value.copy(animations = it)) }) }
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Энергосбережение", Modifier.weight(1f)); Switch(value.powerSaving, { onChange(value.copy(powerSaving = it)) }) }
                    NativeText("Эффекты также учитывают энергосбережение Android и системное отключение анимаций.", color = Muted, fontSize = 12.sp)
                } }
                NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    NativeText("Размер текста · ${(15 * value.textScale).toInt()} sp", color = Muted); Slider(value.textScale, { onChange(value.copy(textScale = it)) }, valueRange = .85f..1.35f)
                    AppearanceChoices("Шрифт", listOf("system" to "Системный", "neutral" to "Нейтральный", "mono" to "Моно"), value.font) { onChange(value.copy(font = it)) }
                    AppearanceChoices("Плотность", listOf("minimal" to "Минимум", "compact" to "Компактно", "standard" to "Стандарт", "large" to "Крупно"), value.density) { onChange(value.copy(density = it)) }
                    NativeText("Размер интерфейса · ${(value.uiScale * 100).toInt()}%", color = Muted); Slider(value.uiScale, { onChange(value.copy(uiScale = it)) }, valueRange = .9f..1.15f)
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Аватары в сообщениях", Modifier.weight(1f)); Switch(value.avatars, { onChange(value.copy(avatars = it)) }) }
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Время по нажатию", Modifier.weight(1f)); Switch(value.timeOnTap, { onChange(value.copy(timeOnTap = it)) }) }
                } }
            }
            NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NativeText("Мои темы", color = Muted)
                themes.forEach { saved -> Row(verticalAlignment = Alignment.CenterVertically) { NativeText(saved.name, Modifier.weight(1f).clickable { apply(saved) }.padding(vertical = 12.dp)); IconButton(onClick = { val copy = saved.copy(id = UUID.randomUUID().toString(), name = (saved.name + " · копия").take(64)); store.save(copy); themes = store.themes(); apply(copy) }) { Icon(Icons.Outlined.ContentCopy, "Создать копию темы") }; IconButton(onClick = { store.remove(saved.id); themes = store.themes() }) { Icon(Icons.Outlined.DeleteOutline, "Удалить тему") } } }
                TextButton(onClick = { name = design.name; naming = true }) { Icon(Icons.Outlined.Add, null); NativeText("Сохранить свою тему") }
                Row { TextButton(onClick = { export.launch("${design.name.replace(Regex("[^a-zA-Zа-яА-Я0-9_-]"), "_")}.volna-theme.json") }, Modifier.weight(1f)) { NativeText("Экспорт") }; TextButton(onClick = { importTheme.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }, Modifier.weight(1f)) { NativeText("Импорт") } }
                TextButton(onClick = { scope.launch { try { val file = withContext(Dispatchers.IO) { File(context.cacheDir, "attachments/themes").apply { mkdirs() }.let { File(it, "volna-theme.json").apply { writeText(store.export(design)) } } }; val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file); context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Поделиться темой")) } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { status = problem.message ?: "Не удалось поделиться темой" } } }) { Icon(Icons.Outlined.Share, null); NativeText("Поделиться темой") }
            } }
            TextButton(onClick = { if (onResetChat != null) { onResetChat(); onDismiss() } else onChange(NativeAppearance()) }) { NativeText(if (chat != null) "Использовать общую тему" else "Вернуть стандартное оформление") }
        }
    }
    colorTarget?.let { target -> NativeColorPicker(when (target) { "incoming" -> variant.incoming; "pattern" -> variant.wallpaper.patternColor.takeIf { it != 0L } ?: variant.accent; else -> variant.accent }, { colorTarget = null }) { color -> when (target) { "incoming" -> updateVariant(variant.copy(incoming = color)); "pattern" -> wallpaper(variant.wallpaper.copy(patternColor = color)); else -> updateVariant(variant.copy(accent = color)) } } }
    if (naming) AlertDialog(onDismissRequest = { naming = false }, title = { NativeText("Название темы") }, text = { NativeOutlinedTextField(name, { name = it.take(64) }, singleLine = true) }, confirmButton = { TextButton(enabled = name.isNotBlank(), onClick = { val theme = design.copy(id = UUID.randomUUID().toString(), name = name.trim()); store.save(theme); themes = store.themes(); apply(theme); naming = false }) { NativeText("Сохранить") } }, dismissButton = { TextButton(onClick = { naming = false }) { NativeText("Отмена") } })
    importing?.let { candidate -> AlertDialog(onDismissRequest = { importing = null }, title = { NativeText(candidate.name) }, text = { NativeThemePreview(value.copy(design = candidate, radius = candidate.radius, theme = if (night) "dark" else "light")) }, confirmButton = { TextButton(onClick = { store.save(candidate); themes = store.themes(); apply(candidate); importing = null }) { NativeText("Применить") } }, dismissButton = { TextButton(onClick = { importing = null }) { NativeText("Отмена") } }) }
    crop?.let { uri -> NativeImageCropEditor(uri, "Фотография фона", { crop = null }, aspect = androidx.compose.ui.platform.LocalConfiguration.current.let { it.screenWidthDp.toFloat() / it.screenHeightDp.coerceAtLeast(1) }) { source -> scope.launch {
        try { val name = withContext(Dispatchers.IO) { val image = android.graphics.BitmapFactory.decodeFile(source.absolutePath) ?: throw IllegalStateException("Изображение недоступно"); val file = File(context.filesDir, "theme-wallpapers").apply { mkdirs() }.let { File(it, UUID.randomUUID().toString() + ".jpg") }; file.outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it) }; image.recycle(); source.delete(); file.name }; wallpaper(variant.wallpaper.copy(type = "image", image = name)); crop = null }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { status = problem.message ?: "Не удалось сохранить фон"; crop = null }
    } } }
}
private fun nativeTimeLabel(minute: Int) = "${(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}"

@Composable
private fun ColorDot(color: Long, selected: Boolean, onClick: () -> Unit) { Box(Modifier.size(44.dp).clip(CircleShape).background(Color(color.toInt())).border(if (selected) 2.dp else 0.dp, TextMain.copy(alpha = .7f), CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) { if (selected) Icon(Icons.Outlined.Check, "Выбранный цвет", tint = nativeReadableText(listOf(Color(color.toInt())))) } }

@Composable
internal fun NativeGradientEditor(colors: List<Long>, max: Int = 4, onChange: (List<Long>) -> Unit) {
    var editing by remember { mutableStateOf<Int?>(null) }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { colors.forEachIndexed { index, color -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
        ColorDot(color, false) { editing = index }
        Row { if (colors.size > 1) IconButton(onClick = { onChange(colors.filterIndexed { i, _ -> i != index }) }, Modifier.size(40.dp)) { Icon(Icons.Outlined.Close, "Удалить цвет ${index + 1}", Modifier.size(16.dp)) }; if (index > 0) IconButton(onClick = { val result = colors.toMutableList(); result[index] = colors[index - 1]; result[index - 1] = color; onChange(result) }, Modifier.size(40.dp)) { Icon(Icons.Outlined.ArrowBack, "Переместить цвет ${index + 1}", Modifier.size(16.dp)) } }
    } }; if (colors.size < max) IconButton(onClick = { onChange(colors + if (colors.last() == 0xFF7C6DEA) 0xFFCB557C else 0xFF7C6DEA) }, Modifier.size(44.dp)) { Icon(Icons.Outlined.Add, "Добавить цвет") } }
    editing?.let { index -> colors.getOrNull(index)?.let { color -> NativeColorPicker(color, { editing = null }) { next -> onChange(colors.mapIndexed { i, current -> if (i == index) next else current }) } } }
}

@Composable
internal fun NativeColorPicker(initial: Long, onDismiss: () -> Unit, onChange: (Long) -> Unit) {
    val hsv = remember { FloatArray(3).also { android.graphics.Color.colorToHSV(initial.toInt(), it) } }
    var hue by remember { mutableStateOf(hsv[0]) }; var saturation by remember { mutableStateOf(hsv[1]) }; var brightness by remember { mutableStateOf(hsv[2]) }
    var hex by remember { mutableStateOf("#%06X".format(initial and 0xFFFFFF)) }; var width by remember { mutableStateOf(1f) }
    fun publish() { val color = android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, brightness)).toLong() and 0xFFFFFFFFL; hex = "#%06X".format(color and 0xFFFFFF); onChange(color) }
    AlertDialog(onDismissRequest = onDismiss, title = { NativeText("Выбрать цвет") }, text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Canvas(Modifier.size(220.dp).align(Alignment.CenterHorizontally).onSizeChanged { width = it.width.toFloat() }.pointerInput(Unit) {
            fun choose(point: Offset) { hue = ((atan2(point.y - width / 2, point.x - width / 2) * 180f / PI.toFloat()) + 360f) % 360f; publish() }
            detectTapGestures { choose(it) }
        }.pointerInput(Unit) { detectDragGestures { change, _ -> hue = ((atan2(change.position.y - width / 2, change.position.x - width / 2) * 180f / PI.toFloat()) + 360f) % 360f; publish(); change.consume() } }) {
            drawCircle(Brush.sweepGradient((0..6).map { Color(android.graphics.Color.HSVToColor(floatArrayOf(it * 60f, 1f, 1f))) }), style = androidx.compose.ui.graphics.drawscope.Stroke(28.dp.toPx()))
            drawCircle(Color(android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, brightness))), radius = size.minDimension * .32f)
            val angle = hue * PI.toFloat() / 180; drawCircle(Color.White, 8.dp.toPx(), center + Offset(cos(angle), sin(angle)) * (size.minDimension / 2 - 14.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
        }
        NativeText("Насыщенность", color = Muted); Slider(saturation, { saturation = it; publish() })
        NativeText("Яркость", color = Muted); Slider(brightness, { brightness = it; publish() })
        NativeOutlinedTextField(hex, { input -> hex = input.take(7); if (hex.matches(Regex("#[0-9a-fA-F]{6}"))) { val color = 0xFF000000L or hex.drop(1).toLong(16); android.graphics.Color.colorToHSV(color.toInt(), hsv); hue = hsv[0]; saturation = hsv[1]; brightness = hsv[2]; onChange(color) } }, label = { NativeText("HEX") }, singleLine = true)
    } }, confirmButton = { TextButton(onClick = onDismiss) { NativeText("Готово") } })
}

@Composable
internal fun NativeThemePreview(appearance: NativeAppearance) {
    VolnaTheme(appearance, updateSystemBars = false) {
        val haze = remember { HazeState() }; val variant = LocalThemeVariant.current
        CompositionLocalProvider(LocalNativeBackdrop provides haze) {
            Box(Modifier.fillMaxWidth().heightIn(min = 244.dp).clip(RoundedCornerShape(22.dp))) {
                NativeWallpaperView(variant.wallpaper, Modifier.matchParentSize().hazeSource(haze))
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(appearance.spacing.coerceAtLeast(2).dp)) {
                    NativeGlassSurface(Modifier.fillMaxWidth(), radius = 14.dp) { Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.ArrowBack, null, Modifier.size(18.dp), tint = Muted)
                        NativeText("Алексей", Modifier.weight(1f).padding(start = 8.dp), color = TextMain, fontSize = 14.sp)
                        Icon(Icons.Outlined.Call, null, Modifier.size(18.dp), tint = Accent)
                    } }
                    NativeMessageContent(false) { NativeText("Привет! 😊", Modifier.clip(RoundedCornerShape(appearance.radius.dp)).background(nativeMessageBrush(false)).padding(appearance.padding.dp), color = TextMain, fontSize = 15.sp) }
                    NativeMessageContent(true) { Row(Modifier.align(Alignment.End).clip(RoundedCornerShape(appearance.radius.dp)).background(nativeMessageBrush(true)).padding(appearance.padding.dp), verticalAlignment = Alignment.Bottom) {
                        NativeText("Как дела?", color = TextMain, fontSize = 15.sp)
                        Icon(Icons.Outlined.DoneAll, "Прочитано", Modifier.padding(start = 6.dp).size(14.dp), tint = Accent)
                    } }
                    NativeMessageContent(false) { Column(Modifier.widthIn(max = 252.dp).clip(RoundedCornerShape(appearance.radius.dp)).background(nativeMessageBrush(false)).padding(appearance.padding.dp)) {
                        val accent = Accent
                        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(30.dp).clip(CircleShape).background(accent), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.PlayArrow, "Пример голосового", Modifier.size(20.dp), tint = AccentText) }
                            Column(Modifier.weight(1f)) {
                                Canvas(Modifier.fillMaxWidth().height(20.dp)) { val bars = 24; val step = size.width / bars; repeat(bars) { i -> val h = (.2f + (i * 7 % 11) / 14f) * size.height; val x = (i + .5f) * step; drawLine(accent.copy(alpha = if (i < 9) 1f else .4f), Offset(x, (size.height - h) / 2), Offset(x, (size.height + h) / 2), strokeWidth = min(2.dp.toPx(), step * .6f), cap = StrokeCap.Round) } }
                                NativeText("0:04 / 0:12", color = Muted, fontSize = 10.sp)
                            }
                            NativeText("1×", color = accent, fontSize = 11.sp)
                            NativeText("А", color = accent, fontSize = 14.sp)
                        }
                        NativeText("👍 2", Modifier.clip(CircleShape).background(Hover).padding(horizontal = 8.dp, vertical = 3.dp), color = TextMain, fontSize = 11.sp)
                    } }
                    Spacer(Modifier.height(4.dp))
                    NativeGlassSurface(Modifier.fillMaxWidth(), radius = 18.dp) { Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.AttachFile, null, Modifier.size(18.dp), tint = Muted)
                        NativeText("Сообщение", Modifier.weight(1f).padding(start = 6.dp), color = Muted, fontSize = 13.sp)
                        Icon(Icons.Outlined.EmojiEmotions, null, Modifier.size(20.dp), tint = Muted)
                        Icon(Icons.Outlined.Mic, null, Modifier.padding(start = 8.dp).size(20.dp), tint = Accent)
                    } }
                }
            }
        }
    }
}
