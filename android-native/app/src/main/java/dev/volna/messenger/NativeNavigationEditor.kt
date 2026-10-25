package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeNavigationCustomization(value: NativeAppearance, onChange: (NativeAppearance) -> Unit) {
    var page by remember { mutableStateOf<String?>(null) }
    NativeSettingsCard { Column {
        NativeSettingRow(Icons.Outlined.Folder, "Оформление папок", "Размер, цвета, подписи и счётчики") { page = "folders" }
        NativeSettingRow(Icons.Outlined.Tune, "Нижняя навигация", "Размер, цвета, иконки и подписи") { page = "bottom" }
        NativeSettingRow(Icons.Outlined.RestartAlt, "Сбросить папки и навигацию", "Стандартное оформление VLN") { onChange(value.copy(foldersStyle = NativeNavigationStyle.Folders, navigationStyle = NativeNavigationStyle.Bottom)) }
    } }
    page?.let { key -> NativeNavigationStyleEditor(value, key == "folders", onChange) { page = null } }
}

@Composable
internal fun NativeNavigationStyleEditor(value: NativeAppearance, folders: Boolean, onChange: (NativeAppearance) -> Unit, onDismiss: () -> Unit) {
    val style = if (folders) value.foldersStyle else value.navigationStyle
    val defaults = if (folders) NativeNavigationStyle.Folders else NativeNavigationStyle.Bottom
    fun change(next: NativeNavigationStyle) { onChange(if (folders) value.copy(foldersStyle = next) else value.copy(navigationStyle = next)) }
    val colors = nativePillColors(style)
    var picking by remember { mutableStateOf<String?>(null) }
    val fields = listOf(Triple("surface", "Подложка", colors.surface), Triple("selected", "Выбранный пункт", colors.selected),
        Triple("text", "Текст и иконки", colors.text), Triple("selectedText", "Текст выбранного пункта", colors.selectedText))
    NativeFullScreen(if (folders) "Оформление папок" else "Нижняя навигация", onDismiss) {
            VolnaTheme(value, updateSystemBars = false) {
                Column(Modifier.fillMaxWidth().background(Ink).padding(vertical = 12.dp)) {
                    if (folders) {
                        val tabs = listOf(NativeFolder("one", "Работа", setOf(1)), NativeFolder("two", "Личное", setOf(2)))
                        val chats = listOf(VolnaChat(1, "Пример", "", "", "", 3, false, 1), VolnaChat(2, "Пример", "", "", "", 0, false, 2))
                        NativeFolderTabs(tabs, chats, "folder:one") {}
                    } else NativeHomeNavigation("chats", null, "", 73, {}, {}, Modifier.padding(horizontal = style.sideInset.dp))
                }
            }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeText("Изменения применяются сразу и сохраняются для этого аккаунта. Автоматические цвета следуют выбранной теме.", color = Muted, fontSize = 12.sp)
            NativeSettingsCard { Column(Modifier.padding(14.dp)) {
                NativeText("Высота может увеличиваться, чтобы вместить текст, значки и счётчики.", color = Muted, fontSize = 12.sp)
                NavigationSlider("Высота элементов", style.height, NativeNavigationStyle.HeightRange, "dp") { change(style.copy(height = it)) }
                NavigationSlider("Скругление", style.radius, NativeNavigationStyle.RadiusRange, "dp") { change(style.copy(radius = it)) }
                NavigationSlider("Отступ по краям", style.sideInset, NativeNavigationStyle.SideInsetRange, "dp") { change(style.copy(sideInset = it)) }
                NavigationSlider(if (folders) "Размер текста и значков" else "Размер подписей", style.textSize, NativeNavigationStyle.TextSizeRange, "sp") { change(style.copy(textSize = it)) }
                if (!folders) NavigationSlider("Размер иконок", style.iconSize, NativeNavigationStyle.IconSizeRange, "dp") { change(style.copy(iconSize = it)) }
            } }
            NativeSettingsCard { Column(Modifier.padding(14.dp)) {
                NavigationSwitch("Показывать подписи", style.labels) { change(style.copy(labels = it, icons = if (!it) true else style.icons)) }
                NavigationSwitch("Показывать иконки", style.icons) { change(style.copy(icons = it, labels = if (!it) true else style.labels)) }
                NavigationSwitch("Показывать счётчики", style.badges) { change(style.copy(badges = it)) }
            } }
            NativeSettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                fields.forEach { (key, title, color) -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).clickable { picking = key }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(24.dp).clip(CircleShape).background(color))
                        NativeText(title, Modifier.padding(start = 10.dp), fontSize = 13.sp)
                    }
                    TextButton(onClick = { change(when (key) { "surface" -> style.copy(surface = 0); "selected" -> style.copy(selected = 0); "text" -> style.copy(text = 0); else -> style.copy(selectedText = 0) }); if (picking == key) picking = null }) { NativeText("Авто", fontSize = 12.sp) }
                } }
                picking?.let { target -> key(target) {
                    val initial = fields.first { it.first == target }.third.toArgb().toLong() and 0xFFFFFFFFL
                    NativeNavigationColorInput(initial, { picking = null }) { color -> change(when (target) { "surface" -> style.copy(surface = color); "selected" -> style.copy(selected = color); "text" -> style.copy(text = color); else -> style.copy(selectedText = color) }) }
                } }
                NativeText("Свои цвета используются в светлой и тёмной теме; «Авто» возвращает цвета текущего оформления.", color = Muted, fontSize = 12.sp)
            } }
            TextButton(onClick = { change(defaults); picking = null }) { NativeText(if (folders) "Сбросить оформление папок" else "Сбросить нижнюю навигацию") }
        }
    }

}

@Composable private fun NavigationSlider(title: String, value: Int, range: IntRange, unit: String, onChange: (Int) -> Unit) {
    NativeText("$title · $value $unit", color = Muted, fontSize = 13.sp)
    Slider(value.toFloat(), { onChange(it.toInt()) }, modifier = Modifier.semantics { contentDescription = title }, valueRange = range.first.toFloat()..range.last.toFloat())
}
@Composable private fun NavigationSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { NativeText(label, Modifier.weight(1f), fontSize = 14.sp); Switch(checked, onChange, modifier = Modifier.semantics { contentDescription = label }) }
}

@Composable
private fun NativeNavigationColorInput(initial: Long, onDone: () -> Unit, onChange: (Long) -> Unit) {
    var hex by remember { mutableStateOf("#%06X".format(initial and 0xFFFFFF)) }
    val valid = hex.matches(Regex("#[0-9a-fA-F]{6}"))
    fun choose(color: Long) { hex = "#%06X".format(color and 0xFFFFFF); onChange(color) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(0xFF182533L, 0xFF2B5278L, 0xFF58B7E8L, 0xFFFFFFFFL, 0xFF7C6DEAL, 0xFF19A18CL, 0xFFE16E43L, 0xFFCB557CL).chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { row.forEach { color ->
                Box(Modifier.size(36.dp).clip(CircleShape).background(Color(color.toInt())).semantics { contentDescription = "Цвет #%06X".format(color and 0xFFFFFF) }.clickable { choose(color) })
            } }
        }
        OutlinedTextField(hex, { input -> hex = input.take(7); if (hex.matches(Regex("#[0-9a-fA-F]{6}"))) onChange(0xFF000000L or hex.drop(1).toLong(16)) },
            label = { NativeText("HEX") }, singleLine = true, isError = !valid, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = onDone, enabled = valid) { NativeText("Готово") }
    }
}
