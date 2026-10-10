@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File

internal class NativePanelState {
    var open by mutableStateOf(false)
    var expanded by mutableStateOf(false)
    var tab by mutableStateOf("emoji")
    var query by mutableStateOf("")
    var searching by mutableStateOf(false)
}
private val emojiGroups = listOf("recent" to "Недавние", "faces" to "Смайлы и люди", "people" to "Люди", "animals" to "Животные и природа", "food" to "Еда и напитки", "travel" to "Путешествия", "activities" to "Деятельность", "objects" to "Предметы", "symbols" to "Символы", "flags" to "Флаги")
private val groupIcons = listOf(Icons.Outlined.History, Icons.Outlined.EmojiEmotions, Icons.Outlined.PanTool, Icons.Outlined.Pets, Icons.Outlined.Restaurant, Icons.Outlined.DirectionsCar, Icons.Outlined.SportsSoccer, Icons.Outlined.Lightbulb, Icons.Outlined.FavoriteBorder, Icons.Outlined.Flag)
private fun nativeEmojiRowKey(row: Pair<String, Any>): String = row.first + when (val value = row.second) {
    is NativeEmojiEntry -> ":unicode:${value.text}"
    is NativeExpression -> ":custom:${value.id}"
    is NativeExpressionPack -> ":suggested:${value.id}"
    else -> ":heading"
}

@Composable
internal fun NativeExpressionPanel(state: NativePanelState, height: Dp, account: Long, token: String, api: NativeApi,
    canSendMedia: Boolean, enabled: Boolean, onEmoji: (String) -> Unit, onCustomEmoji: (NativeExpression) -> Unit,
    onSend: (NativeExpression, () -> Unit) -> Unit, onDelete: () -> Unit, onKeyboard: () -> Unit, onSettings: () -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current; val haptic = LocalHapticFeedback.current
    val catalog = LocalEmojiCatalog.current ?: return
    val motion = LocalMotionEnabled.current
    val emojiSize = with(LocalDensity.current) { 30.dp.toSp() }
    val store = remember(account) { NativeExpressionStore(context, account) }
    val grid = rememberLazyGridState()
    var packs by remember(account) { mutableStateOf(store.packs()) }
    var popularVisible by remember(account) { mutableStateOf(true) }
    var recentGeneration by remember { mutableStateOf(0) }
    var section by remember(state.tab) { mutableStateOf(if (store.packs().any { it.installed && it.kind == state.tab }) "installed" else "catalog") }
    var pendingCategory by remember { mutableStateOf<String?>(null) }
    var remote by remember { mutableStateOf(emptyList<NativeExpression>()) }
    var loading by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var more by remember { mutableStateOf(false) }; var offset by remember { mutableStateOf(0) }; var retry by remember { mutableStateOf(0) }
    var skin by remember { mutableStateOf<NativeEmojiEntry?>(null) }
    var actionItem by remember { mutableStateOf<NativeExpression?>(null) }
    var heldPreview by remember { mutableStateOf<NativeExpression?>(null) }
    var create by remember { mutableStateOf(false) }; var catalogOpen by remember { mutableStateOf(false) }
    var packDetail by remember { mutableStateOf<NativeExpressionPack?>(null) }
    BackHandler(state.searching || state.query.isNotEmpty() || state.expanded) {
        if (state.searching || state.query.isNotEmpty()) { state.searching = false; state.query = ""; focus.clearFocus(); keyboard?.hide() }
        else state.expanded = false
    }
    LaunchedEffect(account, token, retry) {
        try { val result = withContext(Dispatchers.IO) { store.pendingFavorites().forEach { (id, active) -> api.favoriteExpression(token, id, active); store.favoriteSynced(id) }; api.expressionPacks(token) }; packs = result; store.savePacks(result) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Installed metadata remains usable offline. */ }
    }
    LaunchedEffect(state.tab, section, state.query, retry) {
        if (state.tab == "emoji" || section.startsWith("pack:")) return@LaunchedEffect
        delay(300); loading = true; error = ""
        try { val result = withContext(Dispatchers.IO) { api.expressions(token, state.tab, section, state.query) }; remote = result.items; offset = result.offset; more = result.more }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = if (problem is java.io.IOException) "Нет подключения к интернету" else problem.message ?: "Не удалось загрузить GIF"; remote = emptyList(); more = false }
        finally { loading = false }
    }
    fun use(emoji: NativeEmojiEntry) { val selected = store.preferredSkin(emoji, catalog); store.useEmoji(selected.text); recentGeneration++; onEmoji(selected.text) }
    fun send(item: NativeExpression) {
        if (!canSendMedia || !enabled) return
        onSend(item) { store.used(item); recentGeneration++; scope.launch { runCatching { store.cache(api, token, item) } } }
    }
    val recentEmoji = remember(recentGeneration) { store.recentEmoji().mapNotNull { catalog.lookup[it] } }
    val installed = packs.filter { it.installed && it.kind == state.tab }
    val emojiSections = emojiGroups.map { (key, title) -> Triple(key, title, if (key == "recent") recentEmoji else catalog.entries.filter { it.group == key && it.text == it.base }) } + packs.filter { it.installed && it.kind == "emoji" }.map { Triple("pack:${it.id}", it.title, emptyList<NativeEmojiEntry>()) }
    val emojiRows = mutableListOf<Pair<String, Any>>()
    if (state.query.isNotBlank() && state.tab == "emoji") {
        catalog.search(state.query).forEach { emojiRows += "search" to it }
        packs.filter { it.installed && it.kind == "emoji" }.flatMap { it.items }.filter { (it.label + " " + it.keywords.joinToString(" ")).contains(state.query, true) || it.fallback == state.query }.forEach { emojiRows += "search" to it }
    } else if (state.tab == "emoji") {
        val suggested = packs.filter { it.kind == "emoji" && it.isPublic && !it.installed && it.items.isNotEmpty() }.take(8)
        if (popularVisible && suggested.isNotEmpty()) { emojiRows += "popular" to "Популярные наборы эмодзи"; suggested.forEach { emojiRows += "popular" to it } }
        emojiSections.forEach { (key, title, emojis) ->
            val custom = when { key == "recent" -> store.recent().filter { it.kind == "emoji" }; key.startsWith("pack:") -> packs.firstOrNull { "pack:${it.id}" == key }?.items.orEmpty(); else -> emptyList() }
            if (emojis.isNotEmpty() || custom.isNotEmpty()) { emojiRows += key to title; emojis.forEach { emojiRows += key to it }; custom.forEach { emojiRows += key to it } }
        }
    }
    val localItems = when {
        section.startsWith("pack:") -> installed.firstOrNull { "pack:${it.id}" == section }?.items.orEmpty()
        section == "recent" -> store.recent().filter { it.kind == state.tab }
        section == "favorite" -> store.favoriteItems().filter { it.kind == state.tab }
        section == "installed" -> installed.flatMap { it.items }
        else -> emptyList()
    }.filter { state.query.isBlank() || (it.label + " " + it.keywords.joinToString(" ")).contains(state.query, true) || it.fallback == state.query }
    val mediaItems = (if (section.startsWith("pack:")) localItems else remote.filter { it.kind == state.tab } + localItems).distinctBy { it.id }
    LaunchedEffect(pendingCategory, state.query, emojiRows.size) { pendingCategory?.let { key -> val index = emojiRows.indexOfFirst { it.first == key }; if (index >= 0) { if (motion) grid.animateScrollToItem(index) else grid.scrollToItem(index); pendingCategory = null } } }
    val activeCategory = if (state.tab == "emoji") emojiRows.getOrNull(grid.firstVisibleItemIndex)?.first else section
    NativeGlassSurface(modifier = Modifier.fillMaxWidth().height(height), radius = 22.dp) {
        Column {
            Row(Modifier.fillMaxWidth().pointerInput(state.expanded) { detectVerticalDragGestures { change, dy -> change.consume(); if (dy < -10) state.expanded = true else if (dy > 10) state.expanded = false } }, verticalAlignment = Alignment.CenterVertically) {
                LazyRow(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 6.dp)) {
                    if (state.tab == "emoji") {
                        item { IconButton(onClick = { state.query = ""; pendingCategory = "recent" }, modifier = Modifier.size(40.dp)) { Icon(Icons.Outlined.History, "Недавние эмодзи", tint = if (activeCategory == "recent") Accent else Muted) } }
                        item { IconButton(onClick = { state.query = ""; pendingCategory = "faces" }, modifier = Modifier.size(40.dp)) { Icon(Icons.Outlined.EmojiEmotions, "Стандартные эмодзи", tint = if (activeCategory == "faces") Accent else Muted) } }
                        items(packs.filter { it.kind == "emoji" && it.installed }, key = { it.id }) { pack -> IconButton(onClick = { state.query = ""; pendingCategory = "pack:${pack.id}" }, modifier = Modifier.size(40.dp)) { pack.items.firstOrNull()?.let { NativeExpressionImage(it, token, api, store, Modifier.size(28.dp)) } } }
                    } else {
                        items(listOf("recent" to "Недавние", "favorite" to "Избранные", "installed" to "Наборы", "catalog" to "Популярные")) { (key, title) -> IconButton(onClick = { section = key; scope.launch { grid.scrollToItem(0) } }, modifier = Modifier.size(40.dp).clip(CircleShape).background(if (section == key) Hover else Color.Transparent)) { Icon(when (key) { "recent" -> Icons.Outlined.History; "favorite" -> Icons.Outlined.StarOutline; "catalog" -> Icons.Outlined.Explore; else -> Icons.Outlined.Collections }, title, tint = if (section == key) Accent else Muted) } }
                        items(installed, key = { it.id }) { pack -> IconButton(onClick = { section = "pack:${pack.id}"; scope.launch { grid.scrollToItem(0) } }, modifier = Modifier.size(40.dp)) { pack.items.firstOrNull()?.let { NativeExpressionImage(it, token, api, store, Modifier.size(28.dp)) } } }
                    }
                    item { IconButton(onClick = { catalogOpen = true }, modifier = Modifier.size(40.dp)) { Icon(Icons.Outlined.AddCircleOutline, "Добавить или создать набор", tint = Muted) } }
                }
                IconButton(onClick = { state.expanded = !state.expanded }, modifier = Modifier.size(36.dp)) { Icon(if (state.expanded) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.KeyboardArrowUp, if (state.expanded) "Свернуть панель" else "Раскрыть панель", tint = Muted) }
                IconButton(onClick = onSettings, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Settings, "Оформление", tint = Muted) }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 3.dp).clip(RoundedCornerShape(22.dp)).background(Input).height(42.dp).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Search, null, modifier = Modifier.size(20.dp), tint = Muted)
                BasicTextField(state.query, { state.query = it }, modifier = Modifier.weight(1f).padding(horizontal = 8.dp).onFocusChanged { state.searching = it.isFocused }, singleLine = true,
                    textStyle = nativeEmojiTextStyle(LocalTextStyle.current.copy(color = TextMain, fontSize = 14.sp)), visualTransformation = NativeEmojiTransformation(catalog, LocalEmojiFont.current),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(Accent), decorationBox = { field -> Box { if (state.query.isEmpty()) NativeText(when (state.tab) { "gif" -> "Поиск GIF"; "sticker" -> "Поиск стикеров"; else -> "Поиск" }, color = Muted, fontSize = 14.sp); field() } })
                if (state.query.isNotEmpty()) IconButton(onClick = { state.query = "" }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Close, "Очистить поиск", tint = Muted) }
                else if (state.tab == "emoji") LazyRow(Modifier.widthIn(max = 180.dp).weight(1f)) {
                    items(emojiGroups.indices.toList()) { index -> val key = emojiGroups[index].first
                        IconButton(onClick = { state.query = ""; pendingCategory = key }, modifier = Modifier.size(36.dp)) { Icon(groupIcons[index], emojiGroups[index].second, modifier = Modifier.size(21.dp), tint = if (activeCategory == key) Accent else Muted) }
                    }
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            Box(Modifier.weight(1f)) {
                if (state.tab == "emoji") LazyVerticalGrid(columns = GridCells.Adaptive(40.dp), state = grid, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 6.dp)) {
                    itemsIndexed(emojiRows, key = { _, row -> nativeEmojiRowKey(row) }, span = { _, row -> if (row.second is String) GridItemSpan(maxLineSpan) else GridItemSpan(1) }) { _, row ->
                        when (val value = row.second) {
                            is String -> Row(Modifier.fillMaxWidth().padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                NativeText(value, Modifier.weight(1f).padding(vertical = 8.dp), color = Muted, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                                if (row.first == "popular") IconButton(onClick = { popularVisible = false }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Скрыть популярные наборы", tint = Muted, modifier = Modifier.size(18.dp)) }
                            }
                            is NativeExpressionPack -> Box(Modifier.size(40.dp).clickable { packDetail = value }.semantics { contentDescription = "Добавить набор ${value.title}" }, contentAlignment = Alignment.Center) { NativeExpressionImage(value.items.first(), token, api, store, Modifier.size(28.dp)) }
                            is NativeEmojiEntry -> Box(Modifier.size(40.dp).combinedClickable(enabled = enabled, onClick = { use(value) }, onLongClick = { if (catalog.variants(value).size > 1) { skin = value; haptic.performHapticFeedback(HapticFeedbackType.LongPress) } }).semantics { contentDescription = value.name }, contentAlignment = Alignment.Center) { NativeText(store.preferredSkin(value, catalog).text, fontSize = emojiSize) }
                            is NativeExpression -> Box(Modifier.size(40.dp).clickable(enabled = enabled) { onCustomEmoji(value); store.used(value); recentGeneration++ }, contentAlignment = Alignment.Center) { NativeExpressionImage(value, token, api, store, Modifier.size(30.dp), play = grid.layoutInfo.visibleItemsInfo.any { it.key == nativeEmojiRowKey(row) }) }
                        }
                    }
                } else {
                    val visible by remember { derivedStateOf { grid.layoutInfo.visibleItemsInfo.map { it.key }.toSet() } }
                    LazyVerticalGrid(columns = GridCells.Adaptive(if (state.tab == "gif") 128.dp else 80.dp), state = grid, modifier = Modifier.fillMaxSize().pointerInput(mediaItems) {
                        var dragged = false; var initial: NativeExpression? = null
                        fun find(position: androidx.compose.ui.geometry.Offset): NativeExpression? { val item = grid.layoutInfo.visibleItemsInfo.firstOrNull { position.x >= it.offset.x && position.x <= it.offset.x + it.size.width && position.y >= it.offset.y && position.y <= it.offset.y + it.size.height }; return mediaItems.firstOrNull { it.id == item?.key } }
                        detectDragGesturesAfterLongPress(onDragStart = { pos -> initial = find(pos); heldPreview = initial; dragged = false; haptic.performHapticFeedback(HapticFeedbackType.LongPress) }, onDragEnd = { if (!dragged) actionItem = heldPreview; heldPreview = null }, onDragCancel = { heldPreview = null }, onDrag = { change, _ -> change.consume(); find(change.position)?.let { if (it != initial) dragged = true; heldPreview = it } })
                    }, contentPadding = PaddingValues(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(mediaItems, key = { it.id }) { item -> Box(Modifier.height(if (state.tab == "gif") 100.dp else 82.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = canSendMedia && enabled) { send(item) }) { NativeExpressionImage(item, token, api, store, Modifier.fillMaxSize(), play = item.id in visible); if (item.id in store.favorites()) Icon(Icons.Outlined.Star, "В избранном", Modifier.align(Alignment.TopEnd).size(14.dp), tint = Accent) } }
                        if (more && !section.startsWith("pack:")) item(span = { GridItemSpan(maxLineSpan) }) { TextButton(enabled = !loading, onClick = { scope.launch { loading = true; try { val page = withContext(Dispatchers.IO) { api.expressions(token, state.tab, section, state.query, offset) }; remote = (remote + page.items).distinctBy { it.id }; more = page.more; offset = page.offset } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить GIF" } finally { loading = false } } }) { NativeText("Ещё") } }
                    }
                }
                if (!loading && (if (state.tab == "emoji") emojiRows.isEmpty() else mediaItems.isEmpty())) Column(Modifier.align(Alignment.Center).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    NativeText(if (error.isNotBlank() && state.tab != "emoji") error else if (state.query.isNotBlank()) if (state.tab == "gif") "GIF не найдены" else "Ничего не найдено" else "Добавьте набор или выберите раздел", color = Muted, fontSize = 13.sp)
                    TextButton(onClick = { if (error.isNotBlank()) retry++ else catalogOpen = true }) { NativeText(if (error.isNotBlank()) "Повторить" else "Наборы") }
                }
                heldPreview?.let { item -> Box(Modifier.fillMaxSize().background(Panel.copy(alpha = .96f)).padding(12.dp), contentAlignment = Alignment.Center) { NativeExpressionImage(item, token, api, store, Modifier.fillMaxSize(), play = true) } }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onKeyboard) { Icon(Icons.Outlined.Keyboard, "Переключиться на клавиатуру") }
                Row(Modifier.weight(1f).clip(CircleShape).background(Hover), verticalAlignment = Alignment.CenterVertically) {
                listOf("emoji" to "Эмодзи", "sticker" to "Стикеры", "gif" to "GIF").forEach { (key, title) ->
                    val color by androidx.compose.animation.animateColorAsState(if (state.tab == key) Accent else Muted, androidx.compose.animation.core.tween(if (motion) 180 else 0), label = "expression-tab")
                    TextButton(onClick = { if (canSendMedia || key == "emoji") { state.tab = key; state.query = ""; store.lastTab = key; scope.launch { grid.scrollToItem(0) } } }, enabled = key == "emoji" || canSendMedia, modifier = Modifier.weight(1f)) { NativeText(title, color = color, fontSize = 12.sp) }
                }
                }
                NativeRepeatingDelete(onDelete, enabled)
            }
        }
    }
    skin?.let { entry -> Dialog(onDismissRequest = { skin = null }) { Surface(shape = RoundedCornerShape(20.dp), color = Panel) { LazyVerticalGrid(GridCells.Adaptive(48.dp), Modifier.heightIn(max = 220.dp).padding(8.dp)) { items(catalog.variants(entry), key = { it.text }) { variant -> Box(Modifier.size(48.dp).clickable { store.setSkin(variant); store.useEmoji(variant.text); recentGeneration++; onEmoji(variant.text); skin = null }, contentAlignment = Alignment.Center) { NativeText(variant.text, fontSize = emojiSize) } } } } } }
    actionItem?.let { item -> ModalBottomSheet(onDismissRequest = { actionItem = null }, containerColor = Panel) {
        NativeExpressionImage(item, token, api, store, Modifier.fillMaxWidth().height(190.dp), play = true)
        NativeText(item.label, Modifier.padding(horizontal = 16.dp), color = Muted)
        NativeSettingRow(Icons.Outlined.Send, "Отправить", enabled = canSendMedia && enabled) { send(item); actionItem = null }
        NativeSettingRow(Icons.Outlined.StarOutline, if (item.id in store.favorites()) "Удалить из избранного" else "Добавить в избранное") {
            val active = !(item.id in store.favorites()); store.favorite(item, active); recentGeneration++; remote = remote.map { if (it.id == item.id) it.copy(favorite = active) else it }; actionItem = null
            scope.launch { runCatching { withContext(Dispatchers.IO) { api.favoriteExpression(token, item.id, active); store.favoriteSynced(item.id) } }.onFailure { error = "Избранное сохранено на телефоне; сервер пока недоступен" } }
        }
        NativeSettingRow(Icons.Outlined.Collections, "Открыть набор", item.packTitle) { packDetail = packs.firstOrNull { it.id == item.packId }; actionItem = null }
        Spacer(Modifier.height(24.dp))
    } }
    if (catalogOpen) NativePackCatalog(api, token, packs, { catalogOpen = false }, { pack -> packDetail = pack }, { create = true; catalogOpen = false })
    if (create) NativePackCreator(state.tab, api, token, store, { create = false }) { pack -> packs = (packs.filter { it.id != pack.id } + pack); store.savePacks(packs); state.tab = pack.kind; store.lastTab = pack.kind; section = "pack:${pack.id}"; create = false; retry++ }
    packDetail?.let { p -> NativePackDetails(p, token, api, store, { packDetail = null }, { install -> scope.launch { try { withContext(Dispatchers.IO) { api.installExpressionPack(token, p.id, install) }; packs = packs.map { if (it.id == p.id) it.copy(installed = install) else it }; store.savePacks(packs); packDetail = null; retry++ } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось изменить набор"; packDetail = null } } }) }
}

@Composable
private fun NativeRepeatingDelete(onDelete: () -> Unit, enabled: Boolean) {
    val latest by rememberUpdatedState(onDelete)
    Icon(Icons.Outlined.Backspace, "Удалить символ", Modifier.size(48.dp).pointerInput(enabled) {
        if (!enabled) return@pointerInput
        detectTapGestures(onPress = { coroutineScope { latest(); val repeat = launch { delay(400); while (isActive) { latest(); delay(80) } }; try { awaitRelease() } finally { repeat.cancel() } } })
    }.semantics { role = Role.Button; if (!enabled) disabled(); onClick("Удалить символ") { if (enabled) { latest(); true } else false } }.padding(12.dp), tint = Muted)
}

@Composable
private fun NativePackCatalog(api: NativeApi, token: String, packs: List<NativeExpressionPack>, onDismiss: () -> Unit, onSelect: (NativeExpressionPack) -> Unit, onCreate: () -> Unit) {
    var query by remember { mutableStateOf("") }; var items by remember { mutableStateOf(packs) }; var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    LaunchedEffect(query, packs) { delay(300); busy = true; try { items = withContext(Dispatchers.IO) { if (query.matches(Regex("[a-f0-9]{32}"))) listOf(api.expressionPack(token, query)) else api.expressionPacks(token, query) }; error = "" } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Нет подключения к интернету" } finally { busy = false } }
    NativeFullScreen("Наборы", onDismiss) { Column(Modifier.fillMaxSize().padding(12.dp)) {
        NativeOutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { NativeText("Название или код набора") }, singleLine = true)
        TextButton(onClick = onCreate) { Icon(Icons.Outlined.Add, null); NativeText("Создать свой набор") }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()); if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        androidx.compose.foundation.lazy.LazyColumn { items(items, key = { it.id }) { pack -> NativeSettingRow(Icons.Outlined.Collections, pack.title, "${pack.items.size} · ${if (pack.installed) "Установлен" else "Добавить"}") { onSelect(pack) } } }
    } }
}

@Composable
private fun NativePackDetails(pack: NativeExpressionPack, token: String, api: NativeApi, store: NativeExpressionStore, onDismiss: () -> Unit, onInstall: (Boolean) -> Unit) {
    val context = LocalContext.current; val clipboard = LocalClipboardManager.current
    NativeFullScreen(pack.title, onDismiss) { Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row { Button(onClick = { onInstall(!pack.installed) }, Modifier.weight(1f)) { NativeText(if (pack.installed) "Убрать набор" else "Добавить набор") }; if (pack.isPublic) IconButton(onClick = { clipboard.setText(AnnotatedString(pack.id)); context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Набор Волны «${pack.title}»\nКод: ${pack.id}\nВ панели эмодзи нажмите + и вставьте код."), "Поделиться набором")) }) { Icon(Icons.Outlined.Share, "Поделиться набором") } }
        LazyVerticalGrid(GridCells.Adaptive(86.dp), Modifier.weight(1f)) { items(pack.items, key = { it.id }) { NativeExpressionImage(it, token, api, store, Modifier.height(90.dp).padding(4.dp), play = false) } }
    } }
}

@Composable
private fun NativePackCreator(initialKind: String, api: NativeApi, token: String, store: NativeExpressionStore, onDismiss: () -> Unit, onCreated: (NativeExpressionPack) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }; var keywords by remember { mutableStateOf("") }; var fallback by remember { mutableStateOf("✨") }
    var kind by remember { mutableStateOf(initialKind) }; var publicPack by remember { mutableStateOf(false) }; var uris by remember { mutableStateOf(emptyList<Uri>()) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var editUri by remember { mutableStateOf<Uri?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { values -> uris = values.take(20); if (uris.size == 1 && kind != "gif" && context.contentResolver.getType(uris.first()) in listOf("image/png", "image/jpeg")) editUri = uris.first() }
    val packNonce = remember(title, kind, publicPack, keywords, fallback, uris) { java.util.UUID.randomUUID().toString() }
    val uploads = remember { mutableMapOf<Uri, String>() }; val metadata = remember { mutableMapOf<Uri, JSONObject>() }
    NativeFullScreen("Создать набор", { if (!busy) onDismiss() }) { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        NativeOutlinedTextField(title, { title = it.take(64) }, Modifier.fillMaxWidth(), label = { NativeText("Название") }, singleLine = true, enabled = !busy)
        Row { listOf("emoji" to "Эмодзи", "sticker" to "Стикеры", "gif" to "GIF").forEach { (key, label) -> FilterChip(kind == key, { if (!busy) { kind = key; uris = emptyList() } }, label = { NativeText(label) }) } }
        NativeOutlinedTextField(keywords, { keywords = it.take(200) }, Modifier.fillMaxWidth(), label = { NativeText("Ключевые слова через запятую") }, enabled = !busy)
        if (kind == "emoji") NativeOutlinedTextField(fallback, { fallback = it.take(32) }, label = { NativeText("Обычный эмодзи для совместимости") }, enabled = !busy, visualTransformation = NativeEmojiTransformation(LocalEmojiCatalog.current, LocalEmojiFont.current))
        Row(verticalAlignment = Alignment.CenterVertically) { NativeText("Общий каталог Волны", Modifier.weight(1f)); Switch(publicPack, { publicPack = it }, enabled = !busy) }
        NativeText("Статические и анимированные изображения, видеостикеры. До 20 файлов, каждый до 10 МБ.", color = Muted)
        OutlinedButton(enabled = !busy, onClick = { picker.launch(if (kind == "gif") arrayOf("image/gif", "image/webp", "video/mp4", "video/webm") else arrayOf("image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm")) }) { NativeText("Выбрать файлы · ${uris.size}") }
        uris.forEach { uri -> Row(verticalAlignment = Alignment.CenterVertically) { coil.compose.AsyncImage(uri, "Файл набора", Modifier.size(64.dp)); TextButton(onClick = { editUri = uri }, enabled = !busy && kind != "gif" && context.contentResolver.getType(uri) in listOf("image/png", "image/jpeg")) { NativeText("Обрезать") }; IconButton(onClick = { if (!busy) uris = uris - uri }) { Icon(Icons.Outlined.Close, "Убрать файл") } } }
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        Button(enabled = !busy && title.isNotBlank() && uris.isNotEmpty(), onClick = { scope.launch {
            busy = true; error = ""
            try {
                val pack = withContext(Dispatchers.IO) {
                    val rows = uris.map { uri ->
                        (metadata[uri] ?: run {
                            val resolver = context.contentResolver
                            val mime = resolver.getType(uri) ?: if (uri.toString().endsWith(".png")) "image/png" else "application/octet-stream"
                            val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else "Элемент" } ?: "Элемент"
                            val bytes = resolver.openInputStream(uri)?.use { input -> val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(16384); var total = 0; while (true) { val count = input.read(buffer); if (count < 0) break; total += count; require(total <= 10 * 1024 * 1024) { "Файл больше 10 МБ" }; output.write(buffer, 0, count) }; output.toByteArray() } ?: throw IllegalStateException("Файл недоступен")
                            val id = uploads.getOrPut(uri) { api.upload(token, name, mime, bytes) }
                            JSONObject().put("attachment_id", id).put("label", title).put("keywords", org.json.JSONArray(keywords.split(',').map { it.trim() })).put("fallback", if (kind == "emoji") fallback else "✨").also { metadata[uri] = it }
                        }).put("label", title).put("keywords", org.json.JSONArray(keywords.split(',').map { it.trim() })).put("fallback", if (kind == "emoji") fallback else "✨")
                    }
                    api.createExpressionPack(token, title, kind, publicPack, rows, packNonce)
                }; store.savePacks(store.packs() + pack); onCreated(pack)
            } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось создать набор" } finally { busy = false }
        } }) { if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else NativeText("Создать набор") }
    } }
    editUri?.let { uri -> NativeImageCropEditor(uri, "Стикер", { editUri = null }) { file -> val next = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file); uris = uris.map { if (it == uri) next else it }; editUri = null } }
}
