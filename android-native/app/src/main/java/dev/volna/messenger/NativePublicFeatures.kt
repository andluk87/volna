package dev.volna.messenger

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.json.JSONObject
import java.util.UUID

internal fun nativeProfileUrl(username: String) = BuildConfig.API_BASE_URL.trimEnd('/') + "/" + username

@Composable
internal fun NativeUsernameEditor(user: VolnaUser, token: String, api: NativeApi, onSaved: (VolnaUser) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var value by remember(user.username) { mutableStateOf(user.username) }; var result by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    LaunchedEffect(value, token) {
        result = null; error = ""; delay(300)
        try { result = withContext(Dispatchers.IO) { api.checkUsername(token,value) } }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        NativeText("Изменить username", fontSize = 18.sp)
        NativeOutlinedTextField(value,{value=it.take(33)},Modifier.fillMaxWidth(),label={NativeText("@username")},singleLine=true,enabled=!busy)
        NativeText("4–32 символа: латинские буквы, цифры и _. Ник не используется для входа.",color=Muted,fontSize=12.sp)
        if (user.phone.isNotBlank() && (user.username == user.phone.filter { it.isDigit() } || user.username.startsWith(user.phone.filter { it.isDigit() } + "_"))) NativeText("Первоначальный ник содержит ваш номер телефона. Измените его, чтобы убрать номер из публичной ссылки.",color=Muted,fontSize=13.sp)
        result?.let { r ->
            NativeText(r.optString("reason").ifBlank { "@${r.optString("username")} ${if(r.optBoolean("available")) "доступен" else "уже занят"}" },color=if(r.optBoolean("available")) Accent else Muted)
            r.optJSONArray("suggestions")?.let { rows -> for(i in 0 until rows.length()) TextButton(onClick={value=rows.getString(i)},enabled=!busy){NativeText("@${rows.getString(i)}")} }
        }
        if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
        Button(enabled=!busy&&result?.optBoolean("available")==true&&result?.optString("username")!=user.username,onClick={scope.launch {
            busy=true;error="";try{val updated=withContext(Dispatchers.IO){api.changeUsername(token,value)};onSaved(updated);value=updated.username}
            catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty();result=withContext(Dispatchers.IO){runCatching{api.checkUsername(token,value)}.getOrNull()}}finally{busy=false}
        }}){NativeText(if(busy)"Сохраняем…" else "Сохранить username")}
        NativeText(nativeProfileUrl(user.username),Modifier.fillMaxWidth().clickable { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(nativeProfileUrl(user.username)))) },color=Accent,fontSize=13.sp)
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun NativeTopicsDialog(group: VolnaChat, token: String, api: NativeApi, onDismiss: () -> Unit, onChanged: () -> Unit, onSelect: (Long, Long?) -> Unit) {
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val preferences = remember { context.getSharedPreferences("volna-topic-layout", android.content.Context.MODE_PRIVATE) }
    var info by remember(group.id) { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }; var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }; var icon by remember { mutableStateOf("") }
    var creation by remember { mutableStateOf(UUID.randomUUID().toString()) }; var deleting by remember { mutableStateOf<JSONObject?>(null) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }; var emojiPicker by remember { mutableStateOf(false) }
    var revision by remember { mutableStateOf(0) }; var feed by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(false) }; var menu by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }; var query by remember { mutableStateOf("") }
    var layout by remember { mutableStateOf(preferences.getString("${group.id}", "list") ?: "list") }
    suspend fun load(cursor: String? = null) {
        val value = withContext(Dispatchers.IO) { api.topics(token, group.id, cursor, query, paged = true) }
        if (cursor != null) {
            val combined = org.json.JSONArray(); val ids = mutableSetOf<Long>()
            for (source in listOf(info?.optJSONArray("topics"), value.optJSONArray("topics"))) if (source != null)
                for (i in 0 until source.length()) source.getJSONObject(i).let { if (ids.add(it.getLong("id"))) combined.put(it) }
            value.put("topics", combined)
        }
        if (info == null && !value.optBoolean("enabled")) feed = true
        info = value; error = ""
    }
    LaunchedEffect(group.id, token, query) { delay(200); try { load() } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } }
    LaunchedEffect(group.id, token, query) { MessagingService.signals.collect { event ->
        val activity = event.type == "topic-activity" && event.chatId == group.id
        if (activity) revision++
        if (activity || event.type in listOf("topics", "community", "chats", "history-cleared", "connected", "read")) try { load() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
    } }
    fun act(path: String, data: JSONObject = JSONObject(), method: String = "POST", after: (JSONObject) -> Unit = {}) {
        if (busy) return
        scope.launch { busy = true; error = ""; try {
            val target = path.removePrefix("/").toLongOrNull()
            val current = nativeTopicRows(info).firstOrNull { it.optLong("id") == target }
            val payload = JSONObject(data.toString()); if (method == "PATCH" && current != null) payload.put("revision", current.optInt("revision"))
            val result = withContext(Dispatchers.IO) { api.topicAction(token, group.id, path, payload, method) }
            load(); onChanged(); after(result)
        } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) {
            if(problem is NativeApiException && problem.status==409) try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}
            error = problem.message.orEmpty()
        } finally { busy = false } }
    }
    fun edit(topic: JSONObject?) {
        selected = null; editing = topic ?: JSONObject(); name = topic?.optString("name").orEmpty()
        description = topic?.optString("description").orEmpty(); icon = topic?.optString("icon").orEmpty(); creation = UUID.randomUUID().toString()
    }
    val all = nativeTopicRows(info).filter { query.isBlank() || it.optString("name").lowercase().replace('ё','е').contains(query.lowercase().replace('ё','е')) }
    fun open(topic: JSONObject) {
        preferences.edit().putLong("last:${group.id}", topic.getLong("id")).apply()
        onSelect(topic.getLong("id"), null)
    }
    NativeFullScreen(group.name, onDismiss,
        subtitle = "${info?.optInt("member_count", group.memberCount) ?: group.memberCount} участников",
        avatar = { Avatar(group.name, group.id, group.avatarUrl, token, size = 36.dp) },
        actions = {
                IconButton(onClick = { searching = !searching; if (!searching) query = "" }) { Icon(androidx.compose.material.icons.Icons.Outlined.Search, "Поиск по группе") }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(androidx.compose.material.icons.Icons.Outlined.MoreVert, "Меню тем") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { NativeText(if (!feed) "✓ Список тем" else "Список тем") }, onClick = { menu = false; feed = false })
                        DropdownMenuItem(text = { NativeText(if (feed) "✓ Все сообщения" else "Все сообщения") }, onClick = { menu = false; feed = true })
                        DropdownMenuItem(text = { NativeText(if (layout == "tabs") "✓ Вкладки" else "Показывать вкладки") }, onClick = { layout = if (layout == "tabs") "list" else "tabs"; preferences.edit().putString("${group.id}", layout).apply(); menu = false })
                        if (info?.optBoolean("can_create") == true) DropdownMenuItem(text = { NativeText("Создать тему") }, onClick = { menu = false; edit(null) })
                        if (info?.optString("role") == "owner") DropdownMenuItem(text = { NativeText("Настройки тем") }, onClick = { menu = false; settings = true })
                    }
                }
        }) {
        Column(Modifier.fillMaxSize()) {
            if (searching && !feed) NativeOutlinedTextField(query, { query = it.take(64) }, Modifier.fillMaxWidth().padding(horizontal = 12.dp), label = { NativeText("Найти тему") }, singleLine = true)
            if (error.isNotBlank()) NativeText(error, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (info == null && error.isBlank()) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (feed) {
                Box(Modifier.weight(1f)) { NativeForumFeed(group, token, api, revision, onSelect, readVisible = editing == null && !settings && selected == null) }
            } else {
                androidx.compose.foundation.lazy.LazyColumn(Modifier.weight(1f)) {
                    items(all.size, key = { all[it].getLong("id") }) { index ->
                        val topic = all[index]
                        if (!topic.optBoolean("hidden") || info?.optBoolean("can_manage") == true) {
                            NativeTopicRow(topic, onClick = { open(topic) }, onLongClick = { selected = topic })
                            HorizontalDivider(Modifier.padding(start = 76.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .35f))
                        }
                    }
                    if (info?.optJSONObject("general")?.optBoolean("hidden") == true && info?.optBoolean("can_manage") != true) item {
                        TextButton(onClick = { onSelect(group.id, null) }) { NativeText("Открыть общую историю") }
                    }
                    val cursor = info?.optString("next_cursor")?.takeUnless { it.isBlank() || it == "null" }
                    if (cursor != null) item {
                        TextButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { scope.launch { busy = true; try { load(cursor) } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false } } }) { NativeText("Загрузить ещё темы") }
                    }
                    if (info?.optJSONArray("topics")?.length() == 0 && query.isBlank()) item {
                        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                            NativeText("💬", fontSize = 56.sp); NativeText("Пока нет дополнительных тем", fontSize = 18.sp)
                            NativeText("История группы находится в общей теме", color = Muted, fontSize = 13.sp)
                        }
                    }
                    val last = preferences.getLong("last:${group.id}", 0)
                    if (last != 0L && all.any { it.optLong("id") == last }) item {
                        TextButton(onClick = { onSelect(last, null) }, modifier = Modifier.fillMaxWidth()) { NativeText("Вернуться в последнюю тему") }
                    }
                }
                if (info?.optBoolean("can_create") == true) Button(enabled = !busy, onClick = { edit(null) }, modifier = Modifier.fillMaxWidth().padding(12.dp)) { NativeText("Создать тему") }
            }
        }
    }
    selected?.let { topic ->
        val id = topic.getLong("id")
        AlertDialog(onDismissRequest = { selected = null }, title = { NativeText(topic.getString("name")) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                TextButton(onClick = { selected = null; open(topic) }) { NativeText("Открыть тему") }
                TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { withContext(Dispatchers.IO) { if(topic.optLong("last_id")>0) api.markRead(token, id, topic.optLong("last_id")) }; load(); onChanged(); selected = null } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false } } }) { NativeText("Отметить как прочитанную") }
                NativeText("Уведомления", color = Muted, fontSize = 13.sp)
                for ((key, label) in listOf("inherit" to "Как в группе", "all" to "Все сообщения", "mentions" to "Упоминания и ответы", "silent" to "Без звука", "none" to "Отключены").filter { !topic.optBoolean("general") || it.first != "inherit" }) {
                    TextButton(enabled = !busy, onClick = { act("/$id/notifications", JSONObject().put("mode", key)) { selected = null } }) { NativeText((if (topic.optString("notification_mode") == key) "✓ " else "") + label) }
                }
                TextButton(onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(BuildConfig.API_BASE_URL.trimEnd('/') + topic.getString("link"))); selected = null }) { NativeText("Скопировать ссылку") }
                if (topic.optBoolean("can_manage")) {
                    TextButton(enabled = !busy, onClick = { edit(topic) }) { NativeText("Изменить тему") }
                    TextButton(enabled = !busy, onClick = { act("/$id", JSONObject().put("closed", !topic.optBoolean("closed")), "PATCH") { selected = null } }) { NativeText(if (topic.optBoolean("closed")) "Открыть тему повторно" else "Закрыть тему") }
                    TextButton(enabled = !busy, onClick = { act("/$id", JSONObject().put("pinned", !topic.optBoolean("pinned")), "PATCH") { selected = null } }) { NativeText(if (topic.optBoolean("pinned")) "Открепить" else "Закрепить") }
                    if (topic.optBoolean("pinned")) for (delta in listOf(-1, 1)) TextButton(enabled = !busy, onClick = {
                        val pinned = all.filter { it.optBoolean("pinned") }.toMutableList(); val i = pinned.indexOfFirst { it.optLong("id") == id }; val j = i + delta
                        if (j in pinned.indices) { java.util.Collections.swap(pinned, i, j); act("/reorder", JSONObject().put("ids", org.json.JSONArray(pinned.map { it.getLong("id") }))) { selected = null } }
                    }) { NativeText(if (delta < 0) "Выше" else "Ниже") }
                    if (topic.optBoolean("general")) TextButton(enabled = !busy, onClick = { act("/$id", JSONObject().put("hidden", !topic.optBoolean("hidden")), "PATCH") { selected = null } }) { NativeText(if (topic.optBoolean("hidden")) "Показать общую тему" else "Скрыть общую тему") }
                    else TextButton(enabled = !busy, onClick = { selected = null; deleting = topic }) { NativeText("Удалить тему", color = MaterialTheme.colorScheme.error) }
                }
            }
        }, confirmButton = { TextButton(onClick = { selected = null }) { NativeText("Закрыть меню") } })
    }
    editing?.let { topic ->
        NativeFullScreen(if (topic.has("id")) "Изменить тему" else "Новая тема", { if (!busy) editing = null }) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                NativeText("Выберите название и значок темы", color = Muted, fontSize = 14.sp)
                Surface(onClick = { if (!topic.optBoolean("general")) emojiPicker = true }, shape = androidx.compose.foundation.shape.CircleShape, color = Accent.copy(alpha = .2f), modifier = Modifier.size(88.dp)) {
                    Box(contentAlignment = androidx.compose.ui.Alignment.Center) { NativeText(icon.ifBlank { name.trim().let { if(it.isBlank()) "#" else String(Character.toChars(it.codePointAt(0))).uppercase() } }, fontSize = 40.sp) }
                }
                if (!topic.optBoolean("general")) TextButton(onClick = { emojiPicker = true }) { NativeText("Выбрать эмодзи") }
                NativeOutlinedTextField(name, { if (it.codePointCount(0, it.length) <= 64) name = it }, Modifier.fillMaxWidth(), label = { NativeText("Название темы") }, singleLine = true, enabled = !busy)
                NativeText("${name.codePointCount(0, name.length)}/64", Modifier.fillMaxWidth(), color = Muted, fontSize = 12.sp)
                if (!topic.optBoolean("general")) NativeOutlinedTextField(description, { description = it.take(1000) }, Modifier.fillMaxWidth(), label = { NativeText("Описание (необязательно)") }, enabled = !busy)
                if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
                Button(enabled = !busy && name.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                    val data = JSONObject().put("name", name.trim()); if (!topic.optBoolean("general")) data.put("description", description).put("icon", icon)
                    if (!topic.has("id")) data.put("client_id", creation)
                    act(if (topic.has("id")) "/${topic.getLong("id")}" else "", data, if (topic.has("id")) "PATCH" else "POST") { result -> editing = null; if (!topic.has("id")) onSelect(result.getLong("id"), null) }
                }) { NativeText(if (busy) "Сохраняем…" else if (topic.has("id")) "Сохранить" else "Создать") }
                TextButton(enabled = !busy, onClick = { editing = null }) { NativeText("Отмена") }
            }
        }
    }
    if (emojiPicker) NativeTopicEmojiPicker(onDismiss = { emojiPicker = false }, onPick = { icon = it; emojiPicker = false })
    if (settings) NativeFullScreen("Настройки тем", { settings = false }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { NativeText("Включить темы", Modifier.weight(1f)); Switch(info?.optBoolean("enabled") == true, { enabled -> act("/settings", JSONObject().put("enabled", enabled)) { feed = !enabled } }, enabled = !busy) }
            NativeText("Отключение сохраняет темы и всю историю", color = Muted, fontSize = 13.sp)
            for ((field, title, choices) in listOf(Triple("create_policy", "Кто может создавать темы", listOf("owner" to "Владелец", "admins" to "Администраторы", "all" to "Все участники")), Triple("manage_policy", "Кто может управлять темами", listOf("owner" to "Владелец", "admins" to "Администраторы")))) {
                NativeText(title)
                for ((key, label) in choices) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) { RadioButton(info?.optString(field) == key, { act("/settings", JSONObject().put(field, key)) }, enabled = !busy); NativeText(label) }
            }
        }
    }
    deleting?.let { topic -> AlertDialog(onDismissRequest = { if (!busy) deleting = null }, title = { NativeText("Удалить тему?") }, text = { NativeText("Удалить тему «${topic.getString("name") }» вместе со всеми сообщениями? Это действие нельзя отменить.") }, confirmButton = { TextButton(enabled = !busy, onClick = { act("/${topic.getLong("id")}", method = "DELETE") { deleting = null } }) { NativeText("Удалить") } }, dismissButton = { TextButton(enabled = !busy, onClick = { deleting = null }) { NativeText("Отмена") } }) }
}

@Composable
private fun NativeForumFeed(group: VolnaChat, token: String, api: NativeApi, revision: Int, onSelect: (Long,Long?) -> Unit, readVisible: Boolean = true) {
    val scope = rememberCoroutineScope()
    var messages by remember(group.id) { mutableStateOf(emptyList<VolnaMessage>()) }
    var error by remember { mutableStateOf("") }; var query by remember { mutableStateOf("") }
    var more by remember { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }
    val state = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(group.id, token, query, revision) {
        busy = true
        try { delay(250); messages = withContext(Dispatchers.IO) { api.forumMessages(token, group.id, query = query) }; more = messages.size == 50; error = "" }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false }
    }
    val current by rememberUpdatedState(messages)
    LaunchedEffect(group.id, token, readVisible, query) {
        if (!readVisible || query.isNotBlank()) return@LaunchedEffect
        val reported = mutableMapOf<Long, Long>()
        snapshotFlow { state.layoutInfo.visibleItemsInfo.mapNotNull { item -> (item.key as? Long)?.let { id -> current.firstOrNull { it.id == id } } } }.collect { visible ->
            if (MainActivity.isVisible) for ((chatId, rows) in visible.groupBy { it.chatId }) {
                val id = rows.maxOf { it.id }
                if (id > (reported[chatId] ?: 0)) try { withContext(Dispatchers.IO) { api.markRead(token, chatId, id) }; reported[chatId] = id } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        NativeOutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(12.dp), label = { NativeText("Поиск по всем темам") })
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        androidx.compose.foundation.lazy.LazyColumn(state = state, modifier = Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (more) item(key = "older") { TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { val page = withContext(Dispatchers.IO) { api.forumMessages(token, group.id, messages.firstOrNull()?.id, query) }; messages = (page + messages).distinctBy { it.id }; more = page.size == 50 } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false } } }) { NativeText("Ранние сообщения") } }
            items(messages.size, key = { messages[it].id }) { index -> val message = messages[index]
                Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp), color = Panel, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(10.dp)) {
                        TextButton(onClick = { onSelect(message.chatId, message.id) }) { NativeText("${message.topicName.ifBlank { "Общая" }} ›") }
                        NativeText(message.senderName, color = Muted, fontSize = 12.sp)
                        NativeLinkedText(message.text, entities = message.emojiEntities, token = token)
                        message.attachmentName?.let { TextButton(onClick = { onSelect(message.chatId, message.id) }) { NativeText("📎 $it") } }
                    }
                }
            }
            if (messages.isEmpty() && !busy) item(key = "empty") { NativeText("Сообщений пока нет", color = Muted) }
        }
        NativeText("Нажмите на название темы, чтобы перейти к сообщению и ответить", Modifier.padding(12.dp), color = Muted, fontSize = 12.sp)
    }
}

@Composable
internal fun NativeTopicTabs(chat: VolnaChat, token: String, api: NativeApi, onSelect: (Long) -> Unit) {
    val group=chat.parentId.takeIf{it!=0L}?:chat.id
    var info by remember(group){mutableStateOf<JSONObject?>(null)}
    suspend fun load(){info=withContext(Dispatchers.IO){api.topics(token,group)}}
    LaunchedEffect(group,token){try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}}
    LaunchedEffect(group,token){MessagingService.signals.collect{event->if(event.type in listOf("topics","community","chats","read","connected")||event.type=="topic-activity"&&event.chatId==group)try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}}}
    info?.takeIf{it.optBoolean("enabled")}?.let{value ->
        val context=LocalContext.current
        val preferences=remember{context.getSharedPreferences("volna-topic-layout",android.content.Context.MODE_PRIVATE)}
        var savedLayout by remember(group){mutableStateOf(preferences.getString("$group","list"))}
        DisposableEffect(group,preferences){
            val listener=android.content.SharedPreferences.OnSharedPreferenceChangeListener { prefs,key -> if(key=="$group")savedLayout=prefs.getString(key,"list") }
            preferences.registerOnSharedPreferenceChangeListener(listener)
            onDispose{preferences.unregisterOnSharedPreferenceChangeListener(listener)}
        }
        if(savedLayout!="tabs")return
        val all=nativeTopicRows(value).filter{!it.optBoolean("hidden")}
        val state=androidx.compose.foundation.lazy.rememberLazyListState()
        LaunchedEffect(chat.id,all.map{it.optLong("id")}){val index=all.indexOfFirst{it.optLong("id")==chat.id};if(index>=0)state.animateScrollToItem(index)}
        androidx.compose.foundation.lazy.LazyRow(state=state,modifier=Modifier.fillMaxWidth().padding(horizontal=8.dp)) {
            items(all.size,key={all[it].getLong("id")}){i->val topic=all[i];val id=topic.getLong("id");FilterChip(selected=chat.id==id,onClick={onSelect(id)},label={NativeText(topic.optString("icon").ifBlank{"#"}+" "+topic.getString("name")+topic.optInt("unread_count").takeIf{it>0}?.let{" · $it"}.orEmpty(),fontSize=12.sp)},modifier=Modifier.padding(end=4.dp))}
        }
    }
}
