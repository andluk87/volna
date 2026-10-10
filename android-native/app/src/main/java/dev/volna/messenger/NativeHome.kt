@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package dev.volna.messenger

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

@Composable
internal fun ChatListScreen(
    user: VolnaUser?, chats: List<VolnaChat>, query: String, people: List<VolnaUser>, error: String, token: String,
    onQuery: (String) -> Unit, onSelect: (VolnaChat) -> Unit, onChatPreference: (VolnaChat, String, Boolean) -> Unit,
    onStartChat: (VolnaUser) -> Unit, update: VolnaUpdate?, updateBusy: Boolean, updateStatus: String,
    onUpdate: () -> Unit, onScanQr: () -> Unit, onOpenProfile: (Long) -> Unit, onLogout: () -> Unit,
    onAppearance: () -> Unit, onCommunityEntry: (String) -> Unit, onSavedMessages: () -> Unit,
    api: NativeApi, cache: NativeCache, onCall: (VolnaChat) -> Unit, onVideo: (VolnaChat) -> Unit, onSearchMessage: (VolnaMessage) -> Unit,
    onSwitchAccount: (NativeAccount?) -> Unit, onRetry: () -> Unit, onAppearanceChange: (NativeAppearance) -> Unit
) {
    val context = LocalContext.current
    var tab by rememberSaveable(user?.id) { mutableStateOf("chats") }
    var filter by rememberSaveable(user?.id) { mutableStateOf("all") }
    var menu by remember { mutableStateOf(false) }
    var drawerOpen by rememberSaveable { mutableStateOf(false) }
    BackHandler(drawerOpen) { drawerOpen = false }
    var settings by remember { mutableStateOf("") }
    var accountsOpen by remember { mutableStateOf(false) }
    var folders by remember(user?.id) { mutableStateOf(NativeFolders.load(context, user?.id ?: 0)) }
    LaunchedEffect(folders) { if (filter == "all" || filter.startsWith("folder:") && folders.none { "folder:${it.id}" == filter }) filter = folders.firstOrNull()?.let { "folder:${it.id}" } ?: "all" }
    val appearance = LocalNativeAppearance.current
    val motion = LocalMotionEnabled.current
    val pageState = rememberSaveableStateHolder()
    val drafts = remember(user?.id) { NativeDrafts(context, user?.id ?: 0) }
    BackHandler(tab != "chats") { tab = "chats" }
    val backdrop = remember { HazeState() }
    CompositionLocalProvider(LocalNativeBackdrop provides backdrop) {
    Box(Modifier.fillMaxSize()) {
    NativeWallpaperView(if (appearance.design != null) LocalThemeVariant.current.wallpaper else NativeWallpaper(colors = listOf(Panel.toArgb().toLong() and 0xFFFFFFFFL)), Modifier.matchParentSize().hazeSource(backdrop))
    Column(Modifier.fillMaxSize().padding(bottom = 72.dp)) {
        NativeGlassSurface(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), radius = 28.dp, floating = true) { Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (tab == "chats") drawerOpen = true else tab = "chats" }) { if (tab == "chats") Avatar(user?.name ?: "В", user?.id ?: 0, user?.avatarUrl, token, size = 34.dp) else Icon(Icons.Outlined.ArrowBack, "Назад", tint = TextMain) }
            Column(Modifier.weight(1f)) {
                NativeText(when (tab) { "contacts" -> "Контакты"; "calls" -> "Звонки"; "profile" -> "Настройки"; else -> "Волна" }, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = TextMain)
                if (tab == "chats" && error.isNotBlank()) NativeText("Ожидание сети…", fontSize = 12.sp, color = Muted)
            }
            if (tab == "profile") IconButton(onClick = { user?.id?.let(onOpenProfile) }, enabled = user != null) { Icon(Icons.Outlined.Edit, "Редактировать профиль", tint = Accent) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Действия", tint = Muted) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { NativeText("Новый чат") }, leadingIcon = { Icon(Icons.Outlined.ChatBubbleOutline, null) }, onClick = { menu = false; tab = "contacts" })
                    DropdownMenuItem(text = { NativeText("Создать группу") }, leadingIcon = { Icon(Icons.Outlined.Groups, null) }, onClick = { menu = false; onCommunityEntry("create-group") })
                    DropdownMenuItem(text = { NativeText("Создать канал") }, leadingIcon = { Icon(Icons.Outlined.Campaign, null) }, onClick = { menu = false; onCommunityEntry("create-channel") })
                    DropdownMenuItem(text = { NativeText("Войти по приглашению") }, onClick = { menu = false; onCommunityEntry("join") })
                    DropdownMenuItem(text = { NativeText("Избранное") }, leadingIcon = { Icon(Icons.Outlined.BookmarkBorder, null) }, onClick = { menu = false; onSavedMessages() })
                    DropdownMenuItem(text = { NativeText("Архив") }, onClick = { menu = false; filter = "archived"; tab = "chats" })
                    DropdownMenuItem(text = { NativeText("Аккаунты") }, onClick = { menu = false; accountsOpen = true })
                }
            }
        }
        }
        CallAlertsSettings(automatic = true)
        if (update != null) UpdateBanner(update, updateBusy, updateStatus, onUpdate, Modifier.fillMaxWidth().padding(8.dp))
        if (error.isNotBlank()) NativeConnectionNotice(error, onRetry)
        Crossfade(tab, animationSpec = tween(if (motion) 180 else 0), label = "main-section", modifier = Modifier.weight(1f).hazeSource(backdrop, zIndex = 1f, key = "home-content")) { page ->
            pageState.SaveableStateProvider("${user?.id}:$page") {
            when (page) {
                "contacts" -> NativeAccountContactsScreen(user?.id ?: 0, token, api, onStartChat, onOpenProfile, onCall, onVideo)
                "calls" -> NativeCallHistoryScreen(user?.id ?: 0, token, api, cache, chats, onCall, onVideo, { tab = "contacts" })
                "profile" -> NativeSettingsScreen(user, token, appearance, onOpenProfile, onAppearance, onScanQr, onSavedMessages, { settings = it }, { accountsOpen = true }, onAppearanceChange, { tab = "contacts" })
                else -> Column(Modifier.fillMaxSize()) {
                    NativeSearchField(query, onQuery, "Поиск чатов", compact = true)
                    if (query.isBlank()) LazyRow(Modifier.padding(horizontal = 12.dp, vertical = 4.dp).clip(CircleShape).background(Panel.copy(alpha = .64f)), contentPadding = PaddingValues(horizontal = 4.dp, vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        items(folders.map { "folder:${it.id}" to it.name }) { (key, label) ->
                            Row(Modifier.clip(CircleShape).background(if (filter == key) Hover else Color.Transparent).clickable { filter = key }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                NativeText(label, color = if (filter == key) Accent else Muted, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                val unread = chats.count { it.unread > 0 && if (key.startsWith("folder:")) folders.firstOrNull { f -> "folder:${f.id}" == key }?.let { f -> nativeFolderMatches(f, it) } == true else nativeChatFilter(it, key) }
                                if (unread > 0) NativeText(unread.toString(), Modifier.padding(start = 5.dp).clip(CircleShape).background(if (filter == key) Accent else Muted).padding(horizontal = 5.dp, vertical = 1.dp), color = Panel, fontSize = 11.sp)
                            }
                        }
                    }
                    if (query.trim().length >= 2) NativeGlobalSearch(query, token, api, chats, people, onSelect, onStartChat, onSearchMessage)
                    else Box(Modifier.weight(1f)) {
                        val folder = folders.firstOrNull { "folder:${it.id}" == filter }
                        val visible = chats.filter { if (folder != null) nativeFolderMatches(folder, it) else nativeChatFilter(it, filter) }
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                            val archivedCount = chats.count { it.archived }
                            if ((filter == "all" || folder?.rule == "all") && archivedCount > 0) item(key = "archive") {
                                Row(Modifier.fillMaxWidth().clickable { filter = "archived" }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.size(54.dp).clip(CircleShape).background(Panel), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Archive, "Архив", tint = TextMain, modifier = Modifier.size(28.dp)) }
                                    Column(Modifier.padding(start = 12.dp)) { NativeText("Архив чатов", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); NativeText("Чатов: $archivedCount", color = Muted, fontSize = 14.sp) }
                                }
                            }
                            if (visible.isEmpty()) item { NativeEmptyState(Icons.Outlined.ChatBubbleOutline, if (chats.isEmpty()) "Чатов пока нет" else "Здесь пока пусто", "Найдите человека или создайте группу") }
                            items(visible, key = { it.id }) { chat -> NativeChatRow(chat, user?.id, token, drafts.get(chat.id), { onSelect(chat) }, { key, value -> onChatPreference(chat, key, value) }) }
                        }
                        FloatingActionButton(onClick = { tab = "contacts" }, modifier = Modifier.align(Alignment.BottomEnd).padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp), containerColor = Accent, contentColor = AccentText) { Icon(Icons.Outlined.Edit, "Новый чат") }
                    }
                }
            }
        }
        }
    }
        NativeGlassSurface(Modifier.align(Alignment.BottomCenter).padding(horizontal = 28.dp, vertical = 8.dp).fillMaxWidth(), radius = 32.dp, floating = true) {
            Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf(Triple("chats", "Чаты", Icons.Outlined.ChatBubbleOutline), Triple("contacts", "Контакты", Icons.Outlined.AccountCircle), Triple("profile", "Настройки", Icons.Outlined.Settings), Triple("account", "Профиль", Icons.Outlined.PersonOutline)).forEach { (key, label, icon) ->
                    Column(Modifier.weight(1f).clip(CircleShape).background(if (tab == key) Hover else Color.Transparent).clickable { if (key == "account") user?.id?.let(onOpenProfile) else { tab = key; onQuery("") } }.padding(vertical = 7.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        BadgedBox(badge = { if (key == "chats" && chats.any { !it.archived && it.unread > 0 }) Badge(containerColor = Accent) { NativeText(chats.count { !it.archived && it.unread > 0 }.toString(), color = Panel, fontSize = 10.sp) } }) {
                            if (key == "account") Avatar(user?.name ?: "В", user?.id ?: 0, user?.avatarUrl, token, size = 23.dp) else Icon(icon, label, tint = if (tab == key) Accent else TextMain, modifier = Modifier.size(23.dp))
                        }
                        NativeText(label, color = if (tab == key) Accent else TextMain, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
                    }
                }
            }
        }
        if (drawerOpen) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .45f)).clickable { drawerOpen = false })
            Column(Modifier.fillMaxHeight().widthIn(max = 304.dp).fillMaxWidth(.85f).background(Panel)) {
                Column(Modifier.fillMaxWidth().background(Accent).clickable { drawerOpen = false; accountsOpen = true }.padding(16.dp)) {
                    user?.let { Avatar(it.name, it.id, it.avatarUrl, token) }
                    NativeText(user?.name ?: "Волна", Modifier.padding(top = 16.dp), color = AccentText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    NativeText(user?.username?.let { "@$it" }.orEmpty(), color = AccentText, fontSize = 13.sp)
                }
                val entries = listOf(
                    Triple("group", "Создать группу", Icons.Outlined.Groups),
                    Triple("contacts", "Контакты", Icons.Outlined.Contacts),
                    Triple("calls", "Звонки", Icons.Outlined.Call),
                    Triple("saved", "Избранное", Icons.Outlined.BookmarkBorder),
                    Triple("profile", "Настройки", Icons.Outlined.Settings),
                    Triple("channel", "Создать канал", Icons.Outlined.Campaign),
                    Triple("join", "Войти по приглашению", Icons.Outlined.Link),
                    Triple("archived", "Архив", Icons.Outlined.Archive),
                    Triple("accounts", "Аккаунты", Icons.Outlined.PersonOutline)
                )
                LazyColumn(Modifier.weight(1f)) {
                    items(entries) { (key, title, icon) ->
                        Row(Modifier.fillMaxWidth().height(48.dp).clickable {
                            drawerOpen = false
                            when(key) {
                                "group" -> onCommunityEntry("create-group")
                                "channel" -> onCommunityEntry("create-channel")
                                "join" -> onCommunityEntry("join")
                                "saved" -> onSavedMessages()
                                "archived" -> { filter = "archived"; tab = "chats" }
                                "accounts" -> accountsOpen = true
                                else -> tab = key
                            }
                        }.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(icon, null, tint = Muted, modifier = Modifier.size(24.dp))
                            NativeText(title, Modifier.padding(start = 28.dp), fontSize = 15.sp)
                        }
                    }
                }
            }
        }
    } }
    if (accountsOpen) ModalBottomSheet(onDismissRequest = { accountsOpen = false }, containerColor = Panel) {
        NativeText("Аккаунты", Modifier.padding(16.dp), fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
        NativeAccounts.list(context).forEach { account ->
            Row(Modifier.fillMaxWidth().clickable { accountsOpen = false; onSwitchAccount(account) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(account.user.name, account.user.id, account.user.avatarUrl, account.token)
                Column(Modifier.weight(1f).padding(start = 12.dp)) { NativeText(account.user.name); NativeText("@${account.user.username}", color = Muted, fontSize = 13.sp) }
                if (account.user.id == user?.id) Icon(Icons.Outlined.Check, "Текущий аккаунт", tint = Accent)
            }
        }
        TextButton(onClick = { accountsOpen = false; onSwitchAccount(null) }, modifier = Modifier.padding(horizontal = 16.dp)) { Icon(Icons.Outlined.Add, null); NativeText("Добавить аккаунт") }
        TextButton(onClick = { accountsOpen = false; onLogout() }, modifier = Modifier.padding(horizontal = 16.dp)) { NativeText("Выйти из текущего аккаунта", color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(24.dp))
    }
    when (settings) {
        "notifications" -> NativeNotificationSettings(user?.id ?: 0) { settings = "" }
        "security", "devices" -> NativeSessionsScreen(token, api, onScanQr) { settings = "" }
        "storage" -> NativeStorageScreen { settings = "" }
        "folders" -> NativeFoldersDialog(user?.id ?: 0, chats, folders, { folders = it; NativeFolders.save(context, user?.id ?: 0, it) }) { settings = "" }
        "language" -> AlertDialog(onDismissRequest = { settings = "" }, title = { NativeText("Язык") }, text = { NativeText("Русский. Язык клавиатуры и голосового ввода выбирается в настройках Android.") }, confirmButton = { TextButton(onClick = { settings = "" }) { NativeText("Готово") } })
    }
}

@Composable
internal fun NativeSearchField(value: String, onChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    if (compact) {
        Row(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(CircleShape).background(Input.copy(alpha = .64f)).heightIn(min = 42.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Search, null, tint = Muted, modifier = Modifier.size(20.dp))
            BasicTextField(value, onChange, Modifier.weight(1f).padding(horizontal = 10.dp), singleLine = true,
                textStyle = nativeEmojiTextStyle(LocalTextStyle.current.copy(color = TextMain, fontSize = 15.sp)),
                visualTransformation = NativeEmojiTransformation(LocalEmojiCatalog.current, LocalEmojiFont.current), cursorBrush = androidx.compose.ui.graphics.SolidColor(Accent),
                decorationBox = { field -> Box { if (value.isEmpty()) NativeText(hint, color = Muted, fontSize = 15.sp); field() } })
            if (value.isNotEmpty()) IconButton(onClick = { onChange("") }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Очистить поиск", tint = Muted) }
        }
        return
    }
    NativeOutlinedTextField(value, onChange, modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), placeholder = { NativeText(hint, color = Muted) },
        singleLine = true, shape = RoundedCornerShape(24.dp), leadingIcon = { Icon(Icons.Outlined.Search, null, tint = Muted) },
        trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Close, "Очистить поиск", tint = Muted) } },
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, unfocusedBorderColor = Color.Transparent, focusedContainerColor = Input, unfocusedContainerColor = Input, focusedTextColor = TextMain, unfocusedTextColor = TextMain))
}

@Composable
internal fun NativeConnectionNotice(error: String, onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(Input).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.CloudOff, null, tint = Muted, modifier = Modifier.size(20.dp))
        NativeText(error, Modifier.weight(1f).padding(horizontal = 8.dp), color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        TextButton(onClick = onRetry) { NativeText("Повторить", fontSize = 12.sp) }
    }
}

@Composable
internal fun NativeEmptyState(icon: ImageVector, title: String, description: String = "") {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(Hover), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Accent, modifier = Modifier.size(34.dp)) }
        NativeText(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = TextMain, modifier = Modifier.padding(top = 16.dp))
        if (description.isNotBlank()) NativeText(description, color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun NativeGlobalSearch(query: String, token: String, api: NativeApi, chats: List<VolnaChat>, people: List<VolnaUser>, onSelect: (VolnaChat) -> Unit, onPerson: (VolnaUser) -> Unit, onMessage: (VolnaMessage) -> Unit) {
    var found by remember { mutableStateOf(emptyList<VolnaMessage>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(query, token) {
        found = emptyList(); error = ""; busy = true; delay(300)
        try { found = withContext(Dispatchers.IO) { api.searchAllMessages(token, query.trim()) } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "Поиск сообщений недоступен" }
        finally { busy = false }
    }
    val needle = query.trim().removePrefix("@").lowercase()
    val matching = chats.filter { (it.name + " " + it.username).lowercase().contains(needle) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 90.dp)) {
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (error.isNotBlank()) item { NativeText(error, Modifier.padding(16.dp), color = Muted, fontSize = 13.sp) }
        if (matching.isNotEmpty()) item { SectionTitle("ЧАТЫ") }
        items(matching, key = { "chat-${it.id}" }) { NativeChatRow(it, null, token, "", { onSelect(it) }, null) }
        if (people.isNotEmpty()) item { SectionTitle("ЛЮДИ") }
        items(people, key = { "person-${it.id}" }) { PersonRow(it, token) { onPerson(it) } }
        if (found.isNotEmpty()) item { SectionTitle("СООБЩЕНИЯ") }
        items(found, key = { "message-${it.id}" }) { message ->
            Column(Modifier.fillMaxWidth().clickable { onMessage(message) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                NativeText(chats.firstOrNull { it.id == message.chatId }?.name ?: message.senderName, fontWeight = FontWeight.SemiBold, color = TextMain, fontSize = 15.sp)
                NativeText(message.text, color = Muted, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                NativeText(nativeDay(message.createdAt), color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
        if (!busy && error.isBlank() && matching.isEmpty() && people.isEmpty() && found.isEmpty()) item { NativeEmptyState(Icons.Outlined.SearchOff, "Ничего не найдено") }
    }
}

@Composable
internal fun NativeChatRow(chat: VolnaChat, me: Long?, token: String, draft: String, onSelect: () -> Unit, onPreference: ((String, Boolean) -> Unit)?) {
    var menu by remember(chat.id) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().combinedClickable(onClick = onSelect, onLongClick = { if (onPreference != null) menu = true }).padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        if (chat.saved) Box(Modifier.size(54.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.BookmarkBorder, "Избранное", tint = Color.White, modifier = Modifier.size(32.dp)) } else Avatar(chat.name, chat.peerId, chat.avatarUrl, token, size = 54.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                NativeText(chat.name, Modifier.weight(1f), color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (chat.muted) Icon(Icons.Outlined.NotificationsOff, "Уведомления отключены", tint = Muted, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                if (chat.lastSenderId == me && chat.lastId > 0) Icon(if (chat.lastId <= chat.peerDelivered) Icons.Outlined.DoneAll else Icons.Outlined.Done, if (chat.lastId <= chat.peerRead) "Прочитано" else "Отправлено", tint = if (chat.lastId <= chat.peerRead) Accent else Muted, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                if (chat.pinned) Icon(Icons.Outlined.PushPin, "Закреплённый чат", tint = Muted, modifier = Modifier.padding(start = 5.dp).size(12.dp))
                NativeText(nativeClock(chat.lastAt), Modifier.padding(start = 4.dp), color = Muted, fontSize = 12.sp)
            }
            Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                NativeText(if (draft.isNotBlank()) "Черновик: $draft" else chat.lastText.ifBlank { "Начните разговор" }, Modifier.weight(1f), color = if (draft.isNotBlank()) Accent else Muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (chat.unread > 0) Box(Modifier.padding(start = 8.dp).heightIn(min = 22.dp).widthIn(min = 22.dp).clip(CircleShape).background(if (chat.muted) Muted else Accent).padding(horizontal = 6.dp, vertical = 2.dp), contentAlignment = Alignment.Center) { NativeText(chat.unread.toString(), color = if (chat.muted) Panel else AccentText, fontWeight = FontWeight.SemiBold, fontSize = 12.sp) }
            }
        }
        DropdownMenu(menu, { menu = false }) {
            onPreference?.let { action ->
                listOf(Triple("pinned", chat.pinned, if (chat.pinned) "Открепить" else "Закрепить"), Triple("muted", chat.muted, if (chat.muted) "Включить уведомления" else "Без звука"), Triple("archived", chat.archived, if (chat.archived) "Вернуть из архива" else "В архив")).forEach { (key, active, label) -> DropdownMenuItem(text = { NativeText(label) }, onClick = { menu = false; action(key, !active) }) }
            }
        }
    }
}

@Composable
private fun NativeContactsScreen(account: Long, token: String, api: NativeApi, cache: NativeCache, onPerson: (VolnaUser) -> Unit, onProfile: (Long) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var contacts by remember(account) { mutableStateOf(emptyList<VolnaUser>()) }
    var found by remember { mutableStateOf(emptyList<VolnaUser>()) }
    var error by remember { mutableStateOf("") }
    var retry by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var reverse by rememberSaveable { mutableStateOf(false) }
    var personMenu by remember { mutableStateOf<VolnaUser?>(null) }
    LaunchedEffect(account, token, retry) {
        busy = true
        contacts = withContext(Dispatchers.IO) { cache.contacts(account) }
        try { contacts = withContext(Dispatchers.IO) { api.contacts(token) }; withContext(Dispatchers.IO) { cache.saveContacts(account, contacts) }; error = "" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить контакты" }
        finally { busy = false }
    }
    LaunchedEffect(query, token) {
        found = emptyList()
        if (query.trim().length < 2) return@LaunchedEffect
        delay(300)
        try { found = withContext(Dispatchers.IO) { api.searchPeople(token, query.trim()) } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "Поиск недоступен" }
    }
    val needle = query.trim().removePrefix("@").lowercase()
    val visible = (contacts.filter { needle.isBlank() || (it.name + " " + it.username).lowercase().contains(needle) } + found).distinctBy { it.id }.sortedBy { it.name.lowercase() }.let { if (reverse) it.reversed() else it }
    Column(Modifier.fillMaxSize()) {
        NativeSearchField(query, { query = it }, "Имя или @username")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) { NativeText("${visible.size} контактов", Modifier.weight(1f), color = Muted, fontSize = 12.sp); TextButton(onClick = { reverse = !reverse }) { Icon(Icons.Outlined.SortByAlpha, "Сортировать по имени"); NativeText(if (reverse) "Я–А" else "А–Я", fontSize = 12.sp) } }
        if (error.isNotBlank()) NativeConnectionNotice(error) { retry++ }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 90.dp)) {
            if (visible.isEmpty() && !busy) item { NativeEmptyState(Icons.Outlined.Contacts, "Контактов пока нет", "Введите имя или username, чтобы начать диалог") }
            items(visible, key = { it.id }) { person ->
                Row(Modifier.fillMaxWidth().combinedClickable(onClick = { onPerson(person) }, onLongClick = { personMenu = person }).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(person.name, person.id, person.avatarUrl, token, size = 52.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) { NativeText(person.name, color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.Medium); NativeText(if (person.online) "в сети" else "@${person.username}", color = if (person.online) Accent else Muted, fontSize = 13.sp) }
                    IconButton(onClick = { onProfile(person.id) }) { Icon(Icons.Outlined.Info, "Профиль ${person.name}", tint = Muted) }
                }
            }
        }
    }
    personMenu?.let { person -> AlertDialog(onDismissRequest = { personMenu = null }, title = { NativeText(person.name) }, text = { Column { TextButton(onClick = { personMenu = null; onPerson(person) }) { NativeText("Написать") }; TextButton(onClick = { personMenu = null; onProfile(person.id) }) { NativeText("Открыть профиль") } } }, confirmButton = { TextButton(onClick = { personMenu = null }) { NativeText("Закрыть") } }) }
}

@Composable
private fun NativeCallHistoryScreen(account: Long, token: String, api: NativeApi, cache: NativeCache, chats: List<VolnaChat>, onCall: (VolnaChat) -> Unit, onVideo: (VolnaChat) -> Unit, onNew: () -> Unit) {
    val contactNames = rememberNativeContactNames(account)
    val state by NativeCalls.state.collectAsState()
    var history by remember(token) { mutableStateOf(emptyList<VolnaCallRecord>()) }
    var busy by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var retry by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    fun load(older: Boolean = false) {
        if (busy) return
        busy = true
        scope.launch {
            try { val page = withContext(Dispatchers.IO) { api.callHistory(token, if (older) history.lastOrNull()?.created else null) }; history = if (older) (history + page).distinctBy { it.id } else page; more = page.size == 50; withContext(Dispatchers.IO) { cache.saveCalls(account, history) }; error = "" }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить звонки" }
            finally { busy = false }
        }
    }
    LaunchedEffect(token, state.call?.id, retry) { if (history.isEmpty()) history = withContext(Dispatchers.IO) { cache.calls(account) }; load() }
    Column(Modifier.fillMaxSize()) {
        TextButton(onClick = onNew, modifier = Modifier.padding(horizontal = 12.dp)) { Icon(Icons.Outlined.Call, null); NativeText("Новый звонок", Modifier.padding(start = 8.dp)) }
        if (error.isNotBlank()) NativeConnectionNotice(error) { retry++ }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 90.dp)) {
            if (history.isEmpty() && !busy && error.isBlank()) item { NativeEmptyState(Icons.Outlined.Call, "Звонков пока нет", "Здесь появится история ваших звонков") }
            items(history, key = { it.id }) { call ->
                val missed = call.incoming && call.status in listOf("missed", "cancelled", "declined", "interrupted") && call.duration == 0
                val chat = chats.firstOrNull { it.id == call.chatId }
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(contactNames[call.peer?.id] ?: call.peer?.name ?: "Собеседник", call.peer?.id ?: 0, call.peer?.avatarUrl, token, size = 52.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        NativeText(contactNames[call.peer?.id] ?: call.peer?.name ?: "Собеседник", color = if (missed) MaterialTheme.colorScheme.error else TextMain, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (missed) Icons.Outlined.CallMissed else if (call.incoming) Icons.Outlined.CallReceived else Icons.Outlined.CallMade, null, tint = if (missed) MaterialTheme.colorScheme.error else Muted, modifier = Modifier.size(16.dp))
                            NativeText(when { missed -> "Пропущенный"; call.status == "declined" -> "Отклонён"; call.status in listOf("preparing", "ringing", "connecting", "active") -> "В процессе"; call.incoming -> "Входящий"; else -> "Исходящий" } + if (call.duration > 0) " · ${call.duration / 60}:${(call.duration % 60).toString().padStart(2, '0')}" else "", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
                        }
                        NativeText(nativeDay(Instant.ofEpochMilli(call.created).toString()) + " · " + nativeClock(Instant.ofEpochMilli(call.created).toString()) + if (call.screenShared) " · с показом экрана" else "", color = Muted, fontSize = 11.sp)
                    }
                    IconButton(onClick = { chat?.let { if (call.video) onVideo(it) else onCall(it) } }, enabled = chat != null) { Icon(if (call.video) Icons.Outlined.Videocam else Icons.Outlined.Call, "Позвонить ${call.peer?.name.orEmpty()}", tint = Accent) }
                }
            }
            if (more) item { TextButton(onClick = { load(true) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { NativeText("Более ранние звонки") } }
        }
    }
}

@Composable
private fun NativeSettingsScreen(user: VolnaUser?, token: String, appearance: NativeAppearance, onProfile: (Long) -> Unit, onAppearance: () -> Unit, onScanQr: () -> Unit, onSaved: () -> Unit, onSection: (String) -> Unit, onAccounts: () -> Unit, onAppearanceChange: (NativeAppearance) -> Unit, onContacts: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, top = 12.dp, end = 12.dp, bottom = 90.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Surface(color = Panel, shape = RoundedCornerShape(24.dp)) { Column(Modifier.fillMaxWidth().clickable { user?.id?.let(onProfile) }.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) { Avatar(user?.name ?: "Волна", user?.id ?: 0, user?.avatarUrl, token, size = 88.dp); NativeText(user?.name ?: "Подключение…", color = TextMain, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, modifier = Modifier.padding(top = 12.dp)); NativeText("@${user?.username.orEmpty()}", color = Accent, fontSize = 14.sp); user?.phone?.takeIf { it.isNotBlank() }?.let { NativeText(it, color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) } } } }
        item { NativeSettingsCard {
            NativeSettingRow(Icons.Outlined.PersonOutline, "Аккаунт", "Имя, фото и описание") { user?.id?.let(onProfile) }
            NativeSettingRow(Icons.Outlined.Palette, "Настройки чатов", "Оформление, текст и плотность") { onAppearance() }
            NativeSettingRow(Icons.Outlined.Lock, "Конфиденциальность и безопасность", "QR-вход и активные сеансы") { onSection("security") }
            NativeSettingRow(Icons.Outlined.NotificationsNone, "Уведомления", "Сообщения, ответы и реакции") { onSection("notifications") }
        } }
        item { NativeSettingsCard {
            NativeSettingRow(Icons.Outlined.Storage, "Данные и память", "Очистка медиа без удаления переписок") { onSection("storage") }
            NativeSettingRow(Icons.Outlined.FolderOpen, "Папки с чатами", "Собственные подборки переписок") { onSection("folders") }
            NativeSettingRow(Icons.Outlined.Devices, "Устройства", "Просмотр и завершение сессий") { onSection("devices") }
            NativeSettingRow(Icons.Outlined.BookmarkBorder, "Избранное", "Ваши сохранённые сообщения") { onSaved() }
        } }
        item { NativeSettingsCard {
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.BatterySaver, null, tint = Accent); Column(Modifier.weight(1f).padding(start = 12.dp)) { NativeText("Энергосбережение", color = TextMain, fontSize = 15.sp); NativeText("Меньше анимаций и эффектов", color = Muted, fontSize = 12.sp) }; Switch(appearance.powerSaving, { onAppearanceChange(appearance.copy(powerSaving = it)) }) }
            NativeSettingRow(Icons.Outlined.Language, "Язык", "Русский") { onSection("language") }
            NativeSettingRow(Icons.Outlined.Contacts, "Контакты и синхронизация", "Телефонная книга и приватность") { onContacts() }
            NativeSettingRow(Icons.Outlined.ManageAccounts, "Аккаунты", "Добавить или переключить") { onAccounts() }
        } }
        item { NativeText("Эмодзи: Noto Color Emoji 2.051 · Google · SIL OFL 1.1\nДанные: Unicode 17 / CLDR 48 · Unicode License\nСтеклянные эффекты: Haze 1.5.4 · Apache 2.0", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(12.dp)) }
        item { NativeText("Волна ${BuildConfig.VERSION_NAME} · Android\n${android.net.Uri.parse(BuildConfig.API_BASE_URL).host}", color = Muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(12.dp)) }
    }
}

@Composable
internal fun NativeSettingsCard(content: @Composable ColumnScope.() -> Unit) { NativeGlassSurface(radius = 20.dp, backgroundOnly = true) { Column(Modifier.fillMaxWidth(), content = content) } }

@Composable
internal fun NativeSettingRow(icon: ImageVector, title: String, detail: String = "", enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(Hover), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Accent, modifier = Modifier.size(21.dp)) }
        Column(Modifier.weight(1f).padding(start = 12.dp)) { NativeText(title, color = TextMain, fontSize = 15.sp); if (detail.isNotBlank()) NativeText(detail, color = Muted, fontSize = 12.sp) }
        Icon(Icons.Outlined.ChevronRight, null, tint = Muted, modifier = Modifier.size(20.dp))
    }
}
