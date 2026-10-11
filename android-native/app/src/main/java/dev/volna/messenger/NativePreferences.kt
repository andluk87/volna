@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowInsetsControllerCompat
import coil.imageLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

internal val LocalNativeScreenTopInset = staticCompositionLocalOf { 0.dp }

@Composable
internal fun NativeFullScreen(title: String, onDismiss: () -> Unit, overlayContent: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        NativeDialogSystemBars()
        val backdrop = remember { HazeState() }
        val density = androidx.compose.ui.platform.LocalDensity.current
        var headerHeight by remember { mutableStateOf(64.dp) }
        CompositionLocalProvider(LocalNativeBackdrop provides backdrop, LocalNativeScreenTopInset provides if (overlayContent) headerHeight else 0.dp) {
            Surface(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.safeDrawing), color = Ink) {
                Box(Modifier.fillMaxSize()) {
                    NativeWallpaperView(LocalThemeVariant.current.wallpaper, Modifier.matchParentSize().hazeSource(backdrop))
                    Column(Modifier.fillMaxSize().padding(top = if (overlayContent) 0.dp else headerHeight).hazeSource(backdrop, zIndex = 1f, key = "home-content")) { content() }
                    NativeGlassSurface(Modifier.align(Alignment.TopCenter).fillMaxWidth().onSizeChanged { headerHeight = with(density) { it.height.toDp() } }.padding(horizontal = 8.dp, vertical = 4.dp), radius = 28.dp, floating = true) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onDismiss) { Icon(Icons.Outlined.ArrowBack, "Назад", tint = TextMain) }
                            NativeText(title, Modifier.weight(1f).padding(end = 12.dp), color = TextMain, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun NativeDialogSystemBars() {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window
    val color = Ink
    SideEffect { window?.let { target ->
        target.statusBarColor = android.graphics.Color.TRANSPARENT; target.navigationBarColor = android.graphics.Color.TRANSPARENT
        if (android.os.Build.VERSION.SDK_INT >= 29) target.isNavigationBarContrastEnforced = false
        WindowInsetsControllerCompat(target, target.decorView).apply { isAppearanceLightStatusBars = color.luminance() > .5f; isAppearanceLightNavigationBars = color.luminance() > .5f }
    } }
}

internal data class NativeFolder(val id: String, val name: String, val chats: Set<Long>, val rule: String = "", val excluded: Set<Long> = emptySet(), val pinned: List<Long> = emptyList(), val types: Set<String> = emptySet(), val excludeMuted: Boolean = false, val excludeRead: Boolean = false, val excludeArchived: Boolean = false, val icon: String = "")
internal fun nativeFolderMatches(f: NativeFolder, c: VolnaChat): Boolean {
    if (c.parentId > 0 || c.id in f.excluded) return false
    if (c.id in f.chats || c.id in f.pinned) return true
    val types = f.types.any { it == "all" || it == "archived" && c.archived || it == "direct" && (c.kind == "direct" || c.saved) || it == "contacts" && c.kind == "direct" && c.isContact || it == "non_contacts" && c.kind == "direct" && !c.isContact || it == c.kind }
    return (types || f.rule.isNotBlank() && nativeChatFilter(c, f.rule)) && !(f.excludeMuted && c.muted) && !(f.excludeRead && c.unread == 0) && !(f.excludeArchived && c.archived)
}
internal fun nativeDefaultFolders() = listOf("all" to "Все чаты", "direct" to "Личные", "group" to "Группы", "channel" to "Каналы", "unread" to "Непрочитанные", "archived" to "Архив").map { (key, name) -> NativeFolder("builtin_$key", name, emptySet(), key) }
internal object NativeFolders {
    private fun ids(row: JSONObject, key: String): List<Long> { val a = row.optJSONArray(key) ?: JSONArray(); return (0 until a.length()).map { a.optLong(it) }.filter { it > 0 }.distinct().take(500) }
    fun decode(array: JSONArray): List<NativeFolder> = (0 until array.length()).map { array.getJSONObject(it) }.map { r ->
        val t = r.optJSONArray("types") ?: JSONArray()
        NativeFolder(r.getString("id"), r.getString("name"), ids(r, "chats").toSet(), r.optString("rule"), ids(r, "excluded").toSet(), ids(r, "pinned"), (0 until t.length()).map { t.getString(it) }.toSet(), r.optBoolean("excludeMuted"), r.optBoolean("excludeRead"), r.optBoolean("excludeArchived"), r.optString("icon"))
    }
    fun encode(folders: List<NativeFolder>) = JSONArray(folders.take(20).map { JSONObject().put("id", it.id).put("name", it.name).put("chats", JSONArray(it.chats.toList())).put("rule", it.rule).put("excluded", JSONArray(it.excluded.toList())).put("pinned", JSONArray(it.pinned)).put("types", JSONArray(it.types.toList())).put("excludeMuted", it.excludeMuted).put("excludeRead", it.excludeRead).put("excludeArchived", it.excludeArchived).put("icon", it.icon) })
    fun load(context: Context, account: Long): List<NativeFolder> = runCatching {
        val prefs = context.getSharedPreferences("volna-folders-$account", 0)
        val stored = decode(JSONArray(prefs.getString("folders", "[]")))
        if (prefs.getBoolean("builtins_imported", false)) stored else (nativeDefaultFolders() + stored).also { save(context, account, it) }
    }.getOrDefault(nativeDefaultFolders())
    fun save(context: Context, account: Long, folders: List<NativeFolder>) { context.getSharedPreferences("volna-folders-$account", 0).edit().putBoolean("builtins_imported", true).putString("folders", encode(folders).toString()).apply() }
}

@Composable
internal fun NativeFoldersDialog(account: Long, chats: List<VolnaChat>, folders: List<NativeFolder>, onSave: suspend (List<NativeFolder>) -> Boolean, busy: Boolean, cloudError: String, onEditing: (Boolean) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var editing by remember(account) { mutableStateOf<NativeFolder?>(null) }
    var name by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptySet<Long>()) }
    var selectionMode by remember { mutableStateOf("chats") }
    fun edit(folder: NativeFolder) { onEditing(true); editing = folder; name = folder.name; selected = folder.chats; selectionMode = "chats" }
    NativeFullScreen("Папки с чатами", { onEditing(false); onDismiss() }) {
        NativeText("Папки синхронизируются между Android, Web и Windows.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        if (cloudError.isNotBlank()) NativeText(cloudError, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp))
        if (editing == null) {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(folders, key = { it.id }) { folder -> NativeSettingsCard {
                    NativeSettingRow(Icons.Outlined.FolderOpen, folder.icon + folder.name, "${chats.count { nativeFolderMatches(folder, it) }} чатов") { edit(folder) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        val index = folders.indexOf(folder)
                        IconButton(onClick = { val next = folders.toMutableList(); java.util.Collections.swap(next, index, index - 1); scope.launch { onSave(next) } }, enabled = !busy && index > 0) { Icon(Icons.Outlined.ArrowUpward, "Переместить папку вверх") }
                        IconButton(onClick = { val next = folders.toMutableList(); java.util.Collections.swap(next, index, index + 1); scope.launch { onSave(next) } }, enabled = !busy && index < folders.lastIndex) { Icon(Icons.Outlined.ArrowDownward, "Переместить папку вниз") }
                        IconButton(onClick = { scope.launch { onSave(folders + folder.copy(id = UUID.randomUUID().toString(), name = (folder.name + " · копия").take(32))) } }, enabled = !busy && folders.size < 20) { Icon(Icons.Outlined.ContentCopy, "Создать копию папки") }
                    }
                } }
                item { TextButton(onClick = { scope.launch { val prefs = context.getSharedPreferences("volna-folders-$account", 0); val backup = runCatching { NativeFolders.decode(JSONArray(prefs.getString("legacy_backup", "[]"))) }.getOrDefault(emptyList()); val ids = chats.map { it.id }.toSet(); onSave((folders + backup.filter { old -> folders.none { it.id == old.id } }.map { it.copy(chats = it.chats.intersect(ids), excluded = it.excluded.intersect(ids), pinned = it.pinned.filter { id -> id in ids }) }).take(20)) } }, enabled = !busy) { NativeText("Импортировать прежние локальные папки") } }
                item { TextButton(onClick = { scope.launch { onSave((folders + nativeDefaultFolders().filter { old -> folders.none { it.id == old.id } }).take(20)) } }, enabled = !busy) { NativeText("Добавить стандартные папки") } }
                item { TextButton(onClick = { edit(NativeFolder(UUID.randomUUID().toString(), "", emptySet())) }, enabled = !busy && folders.size < 20) { Icon(Icons.Outlined.Add, null); NativeText("Создать папку") } }
            }
        } else {
            NativeOutlinedTextField(name, { name = it.take(32) }, label = { NativeText("Название папки") }, modifier = Modifier.fillMaxWidth().padding(12.dp), singleLine = true, shape = RoundedCornerShape(16.dp))
            LazyColumn(Modifier.weight(1f)) {
                item {
                    Column(Modifier.padding(12.dp)) {
                        listOf("all" to "Все", "direct" to "Личные", "contacts" to "Контакты", "non_contacts" to "Не контакты", "group" to "Группы", "channel" to "Каналы", "archived" to "Архив").forEach { (key, label) ->
                            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(key in editing!!.types, { editing = editing!!.copy(types = if (it) editing!!.types + key else editing!!.types - key) }); NativeText(label) }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(editing!!.excludeRead, { editing = editing!!.copy(excludeRead = it) }); NativeText("Исключить прочитанные") }
                        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(editing!!.excludeMuted, { editing = editing!!.copy(excludeMuted = it) }); NativeText("Исключить без звука") }
                        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(editing!!.excludeArchived, { editing = editing!!.copy(excludeArchived = it) }); NativeText("Исключить архив") }
                        TextButton(onClick = { editing = editing!!.copy(rule = "") }) { NativeText("Убрать исходное правило: ${editing!!.rule}") }
                        NativeOutlinedTextField(editing!!.icon, { editing = editing!!.copy(icon = it.take(12)) }, label = { NativeText("Значок папки") }, singleLine = true)
                        Row { listOf("chats" to "Добавить", "excluded" to "Исключить", "pinned" to "Закрепить").forEach { (key, label) -> TextButton(onClick = { selectionMode = key }) { NativeText(label, color = if (key == selectionMode) Accent else Muted) } } }
                        if (selectionMode == "pinned") editing!!.pinned.forEachIndexed { index, id -> Row(verticalAlignment = Alignment.CenterVertically) {
                            NativeText(chats.find { it.id == id }?.name ?: "Чат", modifier = Modifier.weight(1f))
                            IconButton(onClick = { val pins = editing!!.pinned.toMutableList(); java.util.Collections.swap(pins, index, index - 1); editing = editing!!.copy(pinned = pins) }, enabled = index > 0) { Icon(Icons.Outlined.ArrowUpward, "Поднять закреплённый чат") }
                            IconButton(onClick = { val pins = editing!!.pinned.toMutableList(); java.util.Collections.swap(pins, index, index + 1); editing = editing!!.copy(pinned = pins) }, enabled = index < editing!!.pinned.lastIndex) { Icon(Icons.Outlined.ArrowDownward, "Опустить закреплённый чат") }
                        } }
                        NativeText("Исключения имеют приоритет. Добавленные чаты и закрепления обходят фильтры.", color = Muted, fontSize = 12.sp)
                    }
                }
                items(chats.filter { it.parentId == 0L }, key = { it.id }) { chat ->
                    val checked = when (selectionMode) { "excluded" -> chat.id in editing!!.excluded; "pinned" -> chat.id in editing!!.pinned; else -> chat.id in selected }
                    fun toggle(value: Boolean) { when (selectionMode) {
                        "excluded" -> editing = editing!!.copy(excluded = if (value) editing!!.excluded + chat.id else editing!!.excluded - chat.id)
                        "pinned" -> editing = editing!!.copy(pinned = if (value) editing!!.pinned + chat.id else editing!!.pinned - chat.id)
                        else -> selected = if (value) selected + chat.id else selected - chat.id
                    } }
                    Row(Modifier.fillMaxWidth().clickable { toggle(!checked) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked, { toggle(it) }); NativeText(chat.name, color = TextMain, fontSize = 15.sp, modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().imePadding().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { val id = editing!!.id; scope.launch { if (onSave(folders.filter { it.id != id })) { editing = null; onEditing(false) } } }, enabled = !busy) { NativeText(if (folders.any { it.id == editing?.id }) "Удалить" else "Отмена", color = MaterialTheme.colorScheme.error) }
                Button(onClick = { val next = editing!!.copy(name = name.trim(), chats = selected); scope.launch { if (onSave(if (folders.any { it.id == next.id }) folders.map { if (it.id == next.id) next else it } else folders + next)) { editing = null; onEditing(false) } } }, enabled = !busy && name.isNotBlank()) { NativeText("Сохранить") }
            }
        }
    }
}

internal object NativeNotificationPolicy {
    fun prefs(context: Context, account: Long) = context.getSharedPreferences("volna-notifications-$account", 0)
    fun muted(context: Context, account: Long, chats: List<VolnaChat>) { prefs(context, account).edit().putStringSet("mutedChats", chats.filter { it.muted }.map { it.id.toString() }.toSet()).apply() }
}

@Composable
internal fun NativeNotificationSettings(account: Long, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember(account) { NativeNotificationPolicy.prefs(context, account) }
    var revision by remember { mutableStateOf(0) }
    var ringtoneKind by remember { mutableStateOf("message") }
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            @Suppress("DEPRECATION")
            val selected = result.data?.getParcelableExtra<android.net.Uri>(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
            prefs.edit().putString("${ringtoneKind}_sound_uri", selected?.toString().orEmpty()).apply(); revision++
        }
    }
    fun selectSound(kind: String) {
        ringtoneKind = kind
        val type = if (kind == "call") android.media.RingtoneManager.TYPE_RINGTONE else android.media.RingtoneManager.TYPE_NOTIFICATION
        val current = prefs.getString("${kind}_sound_uri", null)
        val intent = Intent(android.media.RingtoneManager.ACTION_RINGTONE_PICKER)
            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TYPE, type)
            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true)
            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, android.media.RingtoneManager.getDefaultUri(type))
            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, if (current == null) android.media.RingtoneManager.getDefaultUri(type) else current.takeIf { it.isNotBlank() }?.let(android.net.Uri::parse))
        runCatching { picker.launch(intent) }.onFailure { context.startActivity(Intent(Settings.ACTION_SOUND_SETTINGS)) }
    }
    NativeFullScreen("Уведомления", onDismiss) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { NativeSettingsCard {
                listOf("messages" to "Новые сообщения", "mentions" to "Упоминания", "replies" to "Ответы на мои сообщения", "reactions" to "Реакции на мои сообщения", "preview" to "Текст в уведомлениях", "sound" to "Звук сообщений", "message_vibration" to "Вибрация сообщений", "call_sound" to "Звук входящего звонка", "call_vibration" to "Вибрация входящего звонка").forEach { (key, title) ->
                    val checked = remember(revision, key) { prefs.getBoolean(key, true) }
                    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        NativeText(title, Modifier.weight(1f), fontSize = 15.sp, color = TextMain)
                        Switch(checked, { val edit = prefs.edit().putBoolean(key, it); if (key == "sound") edit.putBoolean("message_vibration", prefs.getBoolean("message_vibration", true)); edit.apply(); revision++ })
                    }
                }
            } }
            item { NativeSettingsCard {
                listOf("call" to "Рингтон звонка", "message" to "Звук сообщения").forEach { (kind, label) ->
                    val sound = remember(revision, kind) { prefs.getString("${kind}_sound_uri", null) }
                    val title = if (sound == null) "Системный звук" else if (sound.isBlank()) "Без звука" else runCatching { android.media.RingtoneManager.getRingtone(context, android.net.Uri.parse(sound))?.getTitle(context) }.getOrNull() ?: "Выбранный звук"
                    NativeSettingRow(Icons.Outlined.MusicNote, label, title) { selectSound(kind) }
                }
            } }
            item { NativeSettingsCard { NativeSettingRow(Icons.Outlined.NotificationsActive, "Уведомления Android", "Звук, вибрация, экран блокировки и звонки") { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) } } }
            item { NativeText("Беззвучные чаты настраиваются долгим нажатием в списке чатов. Входящие звонки используют отдельный системный канал.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp)) }
        }
    }
}

@Composable
internal fun NativeSessionsScreen(token: String, api: NativeApi, onScanQr: () -> Unit, onDismiss: () -> Unit) {
    var sessions by remember { mutableStateOf(emptyList<VolnaDeviceSession>()) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var retry by remember { mutableStateOf(0) }
    var pending by remember { mutableStateOf<VolnaDeviceSession?>(null) }
    var revokeOthers by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() { sessions = withContext(Dispatchers.IO) { api.sessions(token) } }
    fun revoke(id: String) { scope.launch { busy = true; try { withContext(Dispatchers.IO) { api.revokeSession(token, id) }; load(); error = "" } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось завершить сессию" } finally { busy = false } } }
    LaunchedEffect(token, retry) { busy = true; try { load(); error = "" } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Устройства недоступны" } finally { busy = false } }
    NativeFullScreen("Безопасность · Активные сеансы", onDismiss) {
        TextButton(onClick = onScanQr, modifier = Modifier.padding(horizontal = 12.dp)) { Icon(Icons.Outlined.QrCodeScanner, null); NativeText("Сканировать QR", Modifier.padding(start = 8.dp)) }
        NativeText("Имя, описание, фото и @username публичны. Пользователя можно найти по полному номеру телефона; первоначальный ник содержит этот номер. Вход на новом устройстве подтверждайте только по своему QR.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
        if (error.isNotBlank()) NativeConnectionNotice(error) { retry++ }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(sessions, key = { it.id }) { session -> NativeSettingsCard {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (session.label.contains("Android")) Icons.Outlined.PhoneAndroid else Icons.Outlined.Computer, null, tint = Accent)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) { NativeText(session.label, fontWeight = FontWeight.Medium, color = TextMain); NativeText(if (session.current) "Это устройство" else if (session.lastSeen > 0) "Активность: ${nativeDay(Instant.ofEpochMilli(session.lastSeen).toString())} ${nativeClock(Instant.ofEpochMilli(session.lastSeen).toString())}" else "Активная сессия", color = Muted, fontSize = 12.sp) }
                    if (!session.current) IconButton(onClick = { pending = session }, enabled = !busy) { Icon(Icons.Outlined.Logout, "Завершить сессию", tint = MaterialTheme.colorScheme.error) }
                }
            } }
            if (sessions.any { !it.current }) item { TextButton(onClick = { revokeOthers = true }, enabled = !busy) { NativeText("Завершить другие сессии", color = MaterialTheme.colorScheme.error) } }
        }
    }
    if (pending != null || revokeOthers) AlertDialog(onDismissRequest = { pending = null; revokeOthers = false }, title = { NativeText("Завершить сессию?") }, text = { NativeText(if (revokeOthers) "На всех других устройствах потребуется снова войти в Волну." else "На устройстве «${pending?.label}» потребуется войти снова.") }, confirmButton = { TextButton(onClick = { val id = if (revokeOthers) "others" else pending!!.id; pending = null; revokeOthers = false; revoke(id) }) { NativeText("Завершить") } }, dismissButton = { TextButton(onClick = { pending = null; revokeOthers = false }) { NativeText("Отмена") } })
}

@Composable
internal fun NativeStorageScreen(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var size by remember { mutableStateOf(0L) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    fun mediaDirectories() = listOf(File(context.cacheDir, "attachments"), File(context.cacheDir, "voices"), File(context.cacheDir, "image_cache"), File(context.cacheDir, "expressions"))
    suspend fun measure() { size = withContext(Dispatchers.IO) { mediaDirectories().sumOf { dir -> if (dir.exists()) dir.walkTopDown().filter { it.isFile }.sumOf { it.length() } else 0L } } }
    LaunchedEffect(Unit) { measure() }
    NativeFullScreen("Данные и память", onDismiss) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            NativeSettingsCard { Column(Modifier.fillMaxWidth().padding(20.dp)) { NativeText("Медиа на устройстве", color = Muted, fontSize = 14.sp); NativeText("%.1f МБ".format(size / 1024.0 / 1024.0), color = TextMain, fontWeight = FontWeight.SemiBold, fontSize = 28.sp); NativeText("Изображения, вложения, голосовые, стикеры и GIF", color = Muted, fontSize = 13.sp) } }
            NativeText("Очистка удалит загруженные копии файлов. Переписки, черновики, настройки и сохранённые вами файлы останутся. Вложения можно снова загрузить с сервера.", color = Muted, fontSize = 14.sp)
            Button(onClick = { scope.launch { busy = true; try { context.imageLoader.memoryCache?.clear(); withContext(Dispatchers.IO) { context.imageLoader.diskCache?.clear(); mediaDirectories().forEach { it.deleteRecursively() } }; measure(); status = "Кэш медиа очищен" } catch (problem: Exception) { status = problem.message ?: "Не удалось очистить кэш" } finally { busy = false } } }, enabled = !busy) { NativeText(if (busy) "Очищаем…" else "Очистить кэш медиа") }
            if (status.isNotBlank()) NativeText(status, color = Accent, fontSize = 13.sp)
            NativeText("На устройстве сохраняются до 500 последних сообщений в каждом из 50 недавно открытых чатов. История остаётся на сервере и подгружается страницами.", color = Muted, fontSize = 12.sp)
            NativeText("Кэш стикеров и GIF ограничен 100 МБ на аккаунт. Установленные наборы, избранное и собственные фоны сохраняются после очистки.", color = Muted, fontSize = 12.sp)
        }
    }
}
