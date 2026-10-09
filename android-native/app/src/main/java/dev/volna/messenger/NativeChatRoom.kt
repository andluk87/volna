@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class, kotlinx.coroutines.FlowPreview::class)
package dev.volna.messenger

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val NativeEmoji = listOf("👍", "❤️", "😂", "🔥", "🎉", "😮", "😢", "🙏", "👏", "😍", "🤔", "💯", "🥰", "👎", "✨", "💙", "😎", "🤝", "👋", "💪", "😭", "😡", "🤗", "🤣")

@Composable
internal fun ChatRoomScreen(
    user: VolnaUser?, chat: VolnaChat, messages: List<VolnaMessage>, busy: Boolean, error: String,
    searchQuery: String, searchResults: List<VolnaMessage>, pinnedMessages: List<VolnaMessage>,
    onSearch: (String) -> Unit, onForward: (VolnaMessage) -> Unit, onOpenProfile: (Long) -> Unit,
    token: String, callActive: Boolean, onCall: (VolnaChat) -> Unit, onVideo: (VolnaChat) -> Unit, onCommunity: () -> Unit, onTopics: () -> Unit,
    moreHistory: Boolean, loadingHistory: Boolean, onLoadOlder: () -> Unit, transcribingMessages: Set<Long>,
    onGallery: () -> Unit, onOpenAttachment: (VolnaMessage) -> Unit,
    onBack: () -> Unit, onSend: (String, Long?, List<NativeEmojiEntity>, Long?, () -> Unit) -> Unit,
    api: NativeApi, onSendExpression: (NativeExpression, Long?, () -> Unit) -> Unit, onAppearance: () -> Unit,
    onPickFiles: (Boolean, String, Long?, () -> Unit) -> Unit,
    onPickExtra: (String, String, Long?, () -> Unit) -> Unit,
    onSendVoice: (java.io.File, Long?, () -> Unit) -> Unit,
    onPlayAudio: (VolnaMessage) -> Unit, voicePlayback: NativeVoicePlayback,
    onMessageAction: (VolnaMessage, String, String) -> Unit, onRetry: () -> Unit,
    focusMessageId: Long?, onFocusConsumed: () -> Unit, onJumpToMessage: (Long) -> Unit,
    startSearch: Boolean, onSearchStarted: () -> Unit, onVisibleMessage: (Long) -> Unit, earlierWindow: Boolean, onNewest: () -> Unit,
    onForwardMany: (List<VolnaMessage>) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val drafts = remember(user?.id) { NativeDrafts(context, user?.id ?: 0) }
    var input by remember(chat.id, user?.id) { mutableStateOf(drafts.input(chat.id)) }
    var entities by remember(chat.id, user?.id) { mutableStateOf(drafts.entities(chat.id)) }
    val panel = remember(chat.id, user?.id) { NativePanelState().apply { tab = NativeExpressionStore(context, user?.id ?: 0).lastTab } }
    val inputFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val catalog = LocalEmojiCatalog.current
    val emojiFont = LocalEmojiFont.current
    val density = LocalDensity.current
    val ime = WindowInsets.ime.getBottom(density) / density.density
    var composerHeight by remember { mutableStateOf(64f) }
    var keyboardHeight by remember { mutableStateOf(300f) }
    LaunchedEffect(ime) { if (ime >= 160 && !panel.open) keyboardHeight = ime }
    fun changeInput(next: TextFieldValue) { if (next.text.length <= 4000) { entities = NativeEmojiEditing.adjustEntities(input.text, next.text, entities); input = next } }
    fun clearInput() { input = TextFieldValue(); entities = emptyList(); drafts.setInput(chat.id, input, entities) }
    fun showKeyboard() { panel.open = false; panel.searching = false; scope.launch { inputFocus.requestFocus(); delay(50); keyboard?.show() } }
    fun togglePanel() { if (panel.open) showKeyboard() else { focus.clearFocus(); keyboard?.hide(); panel.open = true; panel.searching = false;  } }

    var replyTo by remember(chat.id) { mutableStateOf<VolnaMessage?>(null) }
    var editTarget by remember(chat.id) { mutableStateOf<VolnaMessage?>(null) }
    var searchOpen by remember(chat.id) { mutableStateOf(false) }
    var showPins by remember(chat.id) { mutableStateOf(false) }
    var menu by remember(chat.id) { mutableStateOf(false) }
    var attachmentMenu by remember(chat.id) { mutableStateOf(false) }
    var selection by remember(chat.id) { mutableStateOf(emptySet<Long>()) }
    var deleteSelected by remember { mutableStateOf(false) }
    var firstScroll by remember(chat.id) { mutableStateOf(false) }
    var previousCount by remember(chat.id) { mutableStateOf(0) }
    var previousLastId by remember(chat.id) { mutableStateOf<Long?>(null) }
    var newMessages by remember(chat.id) { mutableStateOf(0) }
    var highlighted by remember(chat.id) { mutableStateOf<Long?>(null) }
    val motion = LocalMotionEnabled.current
    val listState = rememberLazyListState()
    val recorder = remember(chat.id) { NativeRecorder(context, scope) { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() } }
    val canModerate = chat.kind in listOf("group", "channel") && chat.role in listOf("owner", "admin")
    val canPin = chat.kind !in listOf("group", "channel") || canModerate
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && !callActive) recorder.start(true) else Toast.makeText(context, "Разрешите микрофон для записи", Toast.LENGTH_SHORT).show()
    }
    SideEffect { recorder.beforeStart = voicePlayback::stop; recorder.onSend = { file ->
        onSendVoice(file, replyTo?.id) { replyTo = null }
    } }
    DisposableEffect(recorder) {
        val owner = context as? androidx.lifecycle.LifecycleOwner
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event -> if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) recorder.cancel() }
        owner?.lifecycle?.addObserver(observer)
        onDispose { owner?.lifecycle?.removeObserver(observer); recorder.cancel() }
    }
    LaunchedEffect(callActive) { if (callActive) recorder.cancel() }
    LaunchedEffect(recorder.recording) { if (recorder.recording) { panel.open = false; focus.clearFocus(); keyboard?.hide() } }
    LaunchedEffect(input, entities, editTarget) { if (editTarget == null) { delay(300); drafts.setInput(chat.id, input, entities) } }
    DisposableEffect(chat.id) { onDispose { if (editTarget == null) drafts.setInput(chat.id, input, entities) } }
    LaunchedEffect(startSearch) { if (startSearch) { searchOpen = true; showPins = false; onSearchStarted() } }
    BackHandler { when { selection.isNotEmpty() -> selection = emptySet(); recorder.recording -> recorder.cancel(); panel.open -> { if (panel.searching || panel.query.isNotEmpty()) { panel.searching = false; panel.query = ""; focus.clearFocus(); keyboard?.hide() } else if (panel.expanded) panel.expanded = false else panel.open = false }; searchOpen -> { searchOpen = false; onSearch("") }; else -> onBack() } }
    val visible = when { searchQuery.isNotBlank() -> searchResults; showPins -> pinnedMessages; else -> messages }
    val groups = remember(visible) { nativeMessageGroups(visible) }
    val historyButton = moreHistory && !searchOpen && !showPins
    val offset = if (historyButton) 1 else 0
    fun jumpBottom() { if (groups.isNotEmpty()) scope.launch { if (motion) listState.animateScrollToItem(groups.lastIndex + offset) else listState.scrollToItem(groups.lastIndex + offset); newMessages = 0 } }
    fun jump(id: Long) {
        val index = groups.indexOfFirst { group -> group.any { it.id == id } }
        if (index >= 0) scope.launch { if (motion) listState.animateScrollToItem(index + offset) else listState.scrollToItem(index + offset); highlighted = id }
        else { showPins = false; searchOpen = false; onSearch(""); onJumpToMessage(id) }
    }
    LaunchedEffect(groups.size, visible.lastOrNull()?.id, searchOpen, showPins) {
        if (groups.isEmpty()) return@LaunchedEffect
        val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        val addedAtEnd = visible.last().id != previousLastId
        if (!firstScroll || addedAtEnd && !searchOpen && !showPins && nativeShouldFollow(lastVisible, previousCount, visible.last().senderId, user?.id)) {
            if (firstScroll && motion) listState.animateScrollToItem(groups.lastIndex + offset) else listState.scrollToItem(groups.lastIndex + offset)
            firstScroll = true; newMessages = 0
        } else if (addedAtEnd && !searchOpen && !showPins && groups.size + offset > previousCount) newMessages += groups.size + offset - previousCount
        previousCount = groups.size + offset; previousLastId = visible.last().id
    }
    LaunchedEffect(focusMessageId, groups.size) { focusMessageId?.let { id -> if (groups.any { group -> group.any { it.id == id } }) { jump(id); onFocusConsumed() } else if (groups.isNotEmpty()) onJumpToMessage(id) } }
    LaunchedEffect(highlighted) { if (highlighted != null) { delay(1800); highlighted = null } }
    val currentGroups by rememberUpdatedState(groups)
    val currentOffset by rememberUpdatedState(offset)
    val reportVisible by rememberUpdatedState(onVisibleMessage)
    LaunchedEffect(chat.id, listState) {
        snapshotFlow { val index = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1; currentGroups.getOrNull(index - currentOffset)?.lastOrNull()?.id }.distinctUntilChanged().debounce(400).collect { id ->
            if (!searchOpen && !showPins && MainActivity.isVisible) id?.let(reportVisible)
        }
    }
    fun select(message: VolnaMessage) { selection = if (message.id in selection) selection - message.id else if (selection.size < 50) selection + message.id else selection }
    fun submit() {
        if (input.text.isBlank() || busy || recorder.recording) return
        onSend(input.text, replyTo?.id, entities, editTarget?.id) { clearInput(); editTarget = null; replyTo = null; jumpBottom() }
    }
    val selected = (messages + searchResults + pinnedMessages).distinctBy { it.id }.filter { it.id in selection }.sortedBy { it.id }
    val backdrop = remember(chat.id) { HazeState() }
    CompositionLocalProvider(LocalNativeBackdrop provides backdrop) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val actualHeight = maxHeight.value
        NativeWallpaperView(if (LocalNativeAppearance.current.design != null) LocalThemeVariant.current.wallpaper else NativeWallpaper(colors = listOf(ChatBackground.toArgb().toLong() and 0xFFFFFFFFL)), Modifier.matchParentSize().hazeSource(backdrop), listState.firstVisibleItemScrollOffset.toFloat())
    Column(Modifier.fillMaxSize()) {
        NativeGlassSurface(Modifier.fillMaxWidth(), radius = 0.dp) { Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (selection.isNotEmpty()) selection = emptySet() else onBack() }) { Icon(if (selection.isNotEmpty()) Icons.Outlined.Close else Icons.Outlined.ArrowBack, "Назад", tint = TextMain) }
            if (selection.isNotEmpty()) {
                NativeText("Выбрано: ${selection.size}", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = TextMain, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Действия с выбранными", tint = Muted) }
                    DropdownMenu(menu, { menu = false }) {
                        if (selected.size == 1 && !selected.first().deleted && chat.canSend) DropdownMenuItem(text = { NativeText("Ответить") }, onClick = { menu = false; replyTo = selected.first(); selection = emptySet() })
                        DropdownMenuItem(text = { NativeText("Копировать") }, onClick = { menu = false; clipboard.setText(AnnotatedString(selected.joinToString("\n") { it.text })); selection = emptySet() })
                    }
                }
                IconButton(onClick = { onForwardMany(selected.filter { !it.deleted }); selection = emptySet() }) { Icon(Icons.Outlined.ArrowForward, "Переслать выбранные", tint = Accent) }
                if (selected.isNotEmpty() && selected.all { !it.deleted && (it.senderId == user?.id || canModerate) }) IconButton(onClick = { deleteSelected = true }) { Icon(Icons.Outlined.DeleteOutline, "Удалить выбранные", tint = MaterialTheme.colorScheme.error) }
            } else {
                Row(Modifier.weight(1f).clickable(enabled = !recorder.recording) { if (chat.kind in listOf("group", "channel")) onCommunity() else if (!chat.saved) onOpenProfile(chat.peerId) }, verticalAlignment = Alignment.CenterVertically) {
                    Avatar(chat.name, chat.peerId, chat.avatarUrl, token, size = 40.dp)
                    Column(Modifier.padding(start = 10.dp)) { NativeText(chat.name, color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis); NativeText(if (chat.saved) "Ваши заметки" else if (chat.parentId!=0L) "Подтема · ${chat.memberCount} участников" else if (chat.kind in listOf("group", "channel")) "${chat.memberCount} участников" else if (chat.peerOnline) "в сети" else "@${chat.username}", color = if (chat.peerOnline) Accent else Muted, fontSize = 12.sp, maxLines = 1) }
                }
                if (chat.kind == "direct" && !chat.saved) IconButton(onClick = { onCall(chat) }, enabled = !recorder.recording) { Icon(Icons.Outlined.Call, "Позвонить", tint = Accent) }
                Box {
                    IconButton(onClick = { menu = true }, enabled = !recorder.recording) { Icon(Icons.Outlined.MoreVert, "Действия чата", tint = Muted) }
                    DropdownMenu(menu, { menu = false }) {
                        if (chat.kind == "direct" && !chat.saved) DropdownMenuItem(text = { NativeText("Видеозвонок") }, leadingIcon = { Icon(Icons.Outlined.Videocam, null) }, enabled = !recorder.recording, onClick = { menu = false; onVideo(chat) })
                        if (chat.kind == "group") DropdownMenuItem(text = { NativeText("Подтемы") }, onClick = { menu = false; onTopics() })
                        DropdownMenuItem(text = { NativeText("Профиль и информация") }, onClick = { menu = false; if (chat.kind in listOf("group", "channel")) onCommunity() else onOpenProfile(chat.peerId) })
                        DropdownMenuItem(text = { NativeText("Изменить оформление") }, leadingIcon = { Icon(Icons.Outlined.Palette, null) }, onClick = { menu = false; onAppearance() })
                        DropdownMenuItem(text = { NativeText("Поиск") }, onClick = { menu = false; searchOpen = !searchOpen; showPins = false; if (!searchOpen) onSearch("") })
                        DropdownMenuItem(text = { NativeText("Общие медиа") }, onClick = { menu = false; onGallery() })
                        DropdownMenuItem(text = { NativeText("Закреплённые") }, onClick = { menu = false; showPins = !showPins; searchOpen = false; onSearch("") })
                        DropdownMenuItem(text = { NativeText("Выбрать сообщения") }, onClick = { menu = false; messages.lastOrNull()?.let(::select) })
                        DropdownMenuItem(text = { NativeText("К последним сообщениям") }, onClick = { menu = false; showPins = false; searchOpen = false; onSearch(""); if (earlierWindow) onNewest() else jumpBottom() })
                    }
                }
            }
        }
        }
        if (searchOpen) NativeSearchField(searchQuery, onSearch, "Найти в переписке")
        if (showPins) Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) { NativeText("Закреплённые · ${pinnedMessages.size}", Modifier.weight(1f), color = Accent, fontSize = 13.sp); TextButton(onClick = { showPins = false }) { NativeText("Закрыть") } }
        if (error.isNotBlank()) NativeConnectionNotice(error, onRetry)
        Box(Modifier.weight(1f).fillMaxWidth().hazeSource(backdrop, zIndex = 1f, key = "history")) {
            if (visible.isEmpty()) Column(Modifier.fillMaxWidth().align(Alignment.Center)) { NativeEmptyState(Icons.Outlined.ChatBubbleOutline, if (searchQuery.isNotBlank()) "Ничего не найдено" else if (showPins) "Нет закреплённых сообщений" else "Начните разговор") }
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(LocalNativeAppearance.current.spacing.dp)) {
                if (historyButton) item(key = "history") { TextButton(onClick = onLoadOlder, enabled = !loadingHistory, modifier = Modifier.fillMaxWidth()) { if (loadingHistory) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else NativeText("Более ранние сообщения", fontSize = 12.sp) } }
                itemsIndexed(groups, key = { _, group -> "${chat.id}-${group.first().id}" }) { index, group ->
                    val message = group.first()
                    val previous = groups.getOrNull(index - 1)?.lastOrNull()
                    if (nativeDay(message.createdAt) != previous?.let { nativeDay(it.createdAt) }) Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) { NativeText(nativeDay(message.createdAt), Modifier.clip(CircleShape).background(Panel).padding(horizontal = 12.dp, vertical = 5.dp), fontSize = 11.sp, color = Muted) }
                    MessageBubble(message, group, message.senderId == user?.id, group.last().id <= chat.peerDelivered, group.last().id <= chat.peerRead, canModerate, canPin, message.id in transcribingMessages,
                        onReply = { replyTo = it; editTarget = null; panel.open = false }, onEdit = { editTarget = it; panel.tab = "emoji"; replyTo = null; input = TextFieldValue(it.text, TextRange(it.text.length)); entities = it.emojiEntities }, onForward = onForward,
                        onCopy = { clipboard.setText(AnnotatedString(it.text)); Toast.makeText(context, "Скопировано", Toast.LENGTH_SHORT).show() }, onAction = onMessageAction,
                        onPlayAudio = onPlayAudio, voicePlayback = voicePlayback, token = token, onOpenAttachment = onOpenAttachment,
                        joined = nativeSameAuthor(previous, message), showAuthor = chat.kind == "group", me = user?.id,
                        selected = group.any { it.id in selection }, selectionMode = selection.isNotEmpty(), onSelect = ::select,
                        onSelectGroup = { val ids = group.map { it.id }.toSet(); selection = if (ids.all { it in selection }) selection - ids else (selection + ids).take(50).toSet() },
                    onJump = ::jump, highlighted = group.any { it.id == highlighted }, onProfile = onOpenProfile, canReply = chat.canSend)
                }
            }
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            if (groups.isNotEmpty() && (earlierWindow || lastVisible < groups.lastIndex + offset - 1)) SmallFloatingActionButton(onClick = { if (earlierWindow) onNewest() else jumpBottom() }, modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp), containerColor = Panel, contentColor = Accent) { BadgedBox(badge = { if (newMessages > 0) Badge { NativeText(newMessages.toString()) } }) { Icon(Icons.Outlined.KeyboardArrowDown, "К новым сообщениям") } }
        }
        if (replyTo != null || editTarget != null) Row(Modifier.fillMaxWidth().background(Panel).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(3.dp).height(34.dp).background(Accent))
            Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) { NativeText(if (editTarget != null) "Редактирование" else "Ответ ${replyTo?.senderName}", color = Accent, fontWeight = FontWeight.Medium, fontSize = 12.sp); NativeText((editTarget?.text ?: replyTo?.text).orEmpty().ifBlank { "Вложение" }, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp) }
            IconButton(onClick = { if (editTarget != null) { input = drafts.input(chat.id); entities = drafts.entities(chat.id) }; replyTo = null; editTarget = null }) { Icon(Icons.Outlined.Close, "Отменить ответ или редактирование", tint = Muted) }
        }
        if (!chat.canSend) NativeText(if(chat.topicClosed) "Подтема закрыта. История доступна для чтения." else "Публиковать могут только администраторы", Modifier.fillMaxWidth().background(Panel).padding(16.dp), color = Muted, fontSize = 13.sp)
        else NativeGlassSurface(Modifier.fillMaxWidth().onSizeChanged { composerHeight = it.height / density.density }, radius = 0.dp) { Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            if (!recorder.recording) IconButton(onClick = { attachmentMenu = true }, enabled = !busy && editTarget == null) { Icon(Icons.Outlined.AttachFile, "Вложение", tint = Muted) }
            if (recorder.recording) {
                IconButton(onClick = recorder::cancel) { Icon(Icons.Outlined.DeleteOutline, "Отменить запись", tint = MaterialTheme.colorScheme.error) }
                Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { NativeText("${recorder.seconds / 60}:${(recorder.seconds % 60).toString().padStart(2, '0')}", color = MaterialTheme.colorScheme.error, fontSize = 12.sp); NativeRecordingWave(recorder.wave, Modifier.weight(1f).padding(start = 8.dp)) }
                    NativeText(if (recorder.locked) "Запись закреплена · нажмите для отправки" else "← отмена · ↑ закрепить", color = Muted, fontSize = 10.sp, maxLines = 1)
                }
            } else {
                NativeRichComposer(input, ::changeInput, entities, user?.id ?: 0, token, api,
                    Modifier.weight(1f).focusRequester(inputFocus).onFocusChanged { if (it.isFocused && panel.open && !panel.searching) panel.open = false },
                    enabled = !busy, maxLines = if (LocalConfiguration.current.screenHeightDp < 480) 3 else 6)
                IconButton(onClick = { if (editTarget != null) panel.tab = "emoji"; togglePanel() }) { Icon(if (panel.open) Icons.Outlined.Keyboard else Icons.Outlined.EmojiEmotions, if (panel.open) "Переключиться на клавиатуру" else "Эмодзи, стикеры и GIF", tint = if (panel.open) Accent else Muted) }
            }
            if (input.text.isBlank() && editTarget == null || recorder.recording) NativeRecordButton(recorder, enabled = !busy && !callActive) { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
            else IconButton(onClick = ::submit, enabled = !busy, modifier = Modifier.size(48.dp).clip(CircleShape).background(Accent)) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = AccentText, strokeWidth = 2.dp) else Icon(if (editTarget != null) Icons.Outlined.Check else Icons.Outlined.Send, "Отправить сообщение", tint = AccentText) }
        } }
        if (panel.open && !recorder.recording && chat.canSend) {
            val reserved = 108f + composerHeight + (if (replyTo != null || editTarget != null) 54f else 0f) + (if (searchOpen || showPins) 56f else 0f) + (if (error.isNotBlank()) 48f else 0f)
            val available = (actualHeight - reserved - if (panel.searching) ime else 0f).coerceAtLeast(80f)
            val normal = keyboardHeight.coerceIn(220f, 360f).coerceAtMost(available)
            val panelHeight = if (panel.expanded && !panel.searching) available.coerceAtMost(700f) else normal
            NativeExpressionPanel(panel, panelHeight.dp, user?.id ?: 0, token, api, editTarget == null, !busy,
                onEmoji = { changeInput(NativeEmojiEditing.insert(input, it)) },
                onCustomEmoji = { item -> val start = input.selection.min; val next = NativeEmojiEditing.insert(input, item.fallback); if (next.text.length <= 4000) { changeInput(next); entities = (entities + NativeEmojiEntity(item.id, start, item.fallback.length, item.attachmentId, item.mime)).sortedBy { it.start } } },
                onSend = { item, sent -> onSendExpression(item, replyTo?.id) { replyTo = null; sent(); jumpBottom() } },
                onDelete = { changeInput(NativeEmojiEditing.delete(input, catalog)) }, onKeyboard = ::showKeyboard)
            if (panel.searching) Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.ime))
        } else Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.ime))
    }
    } }
    if (attachmentMenu) ModalBottomSheet(onDismissRequest = { attachmentMenu = false }, containerColor = Panel) {
        NativeText("Вложение", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        val options = listOf(Triple("gallery", "Галерея", Icons.Outlined.PhotoLibrary), Triple("camera", "Камера", Icons.Outlined.PhotoCamera), Triple("file", "Файл", Icons.Outlined.Description), Triple("location", "Местоположение", Icons.Outlined.LocationOn), Triple("contact", "Контакт", Icons.Outlined.PersonOutline), Triple("music", "Музыка", Icons.Outlined.MusicNote))
        options.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                row.forEach { (key, label, icon) ->
                    Column(Modifier.weight(1f).clickable {
                        attachmentMenu = false
                        val caption = input.text
                        val sent = { if (input.text == caption) clearInput(); replyTo = null }
                        if (key == "gallery" || key == "file") onPickFiles(key == "gallery", caption, replyTo?.id, sent)
                        else onPickExtra(key, caption, replyTo?.id, sent)
                    }.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(icon, label, tint = Accent, modifier = Modifier.size(32.dp))
                        NativeText(label, fontSize = 12.sp, color = TextMain, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
    if (deleteSelected) AlertDialog(onDismissRequest = { deleteSelected = false }, title = { NativeText("Удалить ${selected.size} сообщений?") }, text = { NativeText("Сообщения будут удалены у всех участников переписки.") }, confirmButton = { TextButton(onClick = { selected.forEach { onMessageAction(it, "delete", "") }; selection = emptySet(); deleteSelected = false }) { NativeText("Удалить", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { deleteSelected = false }) { NativeText("Отмена") } })
}

@Composable
private fun MessageBubble(message: VolnaMessage, group: List<VolnaMessage>, isMine: Boolean, peerDelivered: Boolean, peerRead: Boolean, canModerate: Boolean, canPin: Boolean, transcribing: Boolean,
    onReply: (VolnaMessage) -> Unit, onEdit: (VolnaMessage) -> Unit, onForward: (VolnaMessage) -> Unit, onCopy: (VolnaMessage) -> Unit, onAction: (VolnaMessage, String, String) -> Unit,
    onPlayAudio: (VolnaMessage) -> Unit, voicePlayback: NativeVoicePlayback, token: String, onOpenAttachment: (VolnaMessage) -> Unit,
    joined: Boolean, showAuthor: Boolean, me: Long?, selected: Boolean, selectionMode: Boolean, onSelect: (VolnaMessage) -> Unit, onSelectGroup: () -> Unit, onJump: (Long) -> Unit, highlighted: Boolean, onProfile: (Long) -> Unit, canReply: Boolean
) {
    var menu by remember(message.id) { mutableStateOf(false) }
    var targetId by remember(message.id) { mutableStateOf(message.id) }
    var detail by remember(message.id) { mutableStateOf(false) }
    var reactionPicker by remember(message.id) { mutableStateOf(false) }
    var reactionPeople by remember(message.id) { mutableStateOf(false) }
    val target = group.firstOrNull { it.id == targetId } ?: message
    val appearance = LocalNativeAppearance.current
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp / appearance.uiScale
    val available = screenWidth - 20.dp - (if (selectionMode) 44.dp else 0.dp) - (if (appearance.avatars && showAuthor && !isMine) 36.dp else 0.dp)
    val maxWidth = (screenWidth * .75f).coerceAtMost(available).coerceAtMost(560.dp).coerceAtLeast(80.dp)
    val sticker = message.expressionKind == "sticker" || message.attachmentMime == "image/webp" && message.attachmentName.orEmpty().startsWith("Стикер-")
    NativeMessageContent(isMine) { Row(Modifier.fillMaxWidth().background(if (selected || highlighted) Accent.copy(alpha = .12f) else Color.Transparent), horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Bottom) {
        if (selectionMode) Checkbox(selected, { onSelectGroup() }, modifier = Modifier.size(44.dp))
        if (appearance.avatars && showAuthor && !isMine) Box(Modifier.width(36.dp).heightIn(min = 32.dp), contentAlignment = Alignment.BottomCenter) { if (!joined) Box(Modifier.clickable { onProfile(message.senderId) }) { Avatar(message.senderName, message.senderId, size = 28.dp) } }
        val shape = RoundedCornerShape(topStart = if (joined && !isMine) 6.dp else appearance.radius.dp, topEnd = if (joined && isMine) 6.dp else appearance.radius.dp, bottomEnd = appearance.radius.dp, bottomStart = appearance.radius.dp)
        Column(Modifier.widthIn(min = if (message.attachmentMime?.startsWith("audio/") == true && !message.deleted) maxWidth.coerceAtMost(340.dp) else 0.dp, max = maxWidth).clip(shape).background(if (sticker && !message.deleted) androidx.compose.ui.graphics.SolidColor(Color.Transparent) else nativeMessageBrush(isMine))
            .combinedClickable(onClick = { if (selectionMode) onSelectGroup() else detail = !detail }, onLongClick = { if (selectionMode) onSelectGroup() else { targetId = message.id; menu = true } })
            .padding(horizontal = if (appearance.density == "minimal") 7.dp else 10.dp, vertical = appearance.padding.dp)) {
            if (showAuthor && !isMine && !joined && !message.deleted) NativeText(message.senderName, Modifier.clickable { onProfile(message.senderId) }, color = Accent, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            if (message.forwardedName != null) NativeText("Переслано от ${message.forwardedName}", color = Muted, fontSize = 11.sp)
            message.reply?.let { reply -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Hover).clickable { onJump(reply.id) }.padding(6.dp)) { Box(Modifier.width(3.dp).height(30.dp).background(Accent)); Column(Modifier.padding(start = 8.dp)) { NativeText(reply.name, color = Accent, fontSize = 12.sp, fontWeight = FontWeight.Medium); NativeText(reply.text, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) } } }
            if (message.deleted) NativeText("Сообщение удалено", color = Muted, fontSize = 14.sp)
            else if (group.size > 1) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                group.chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { pair.forEach { photo -> Column(Modifier.weight(1f)) { AttachmentThumbnail(photo, token, { if (selectionMode) onSelect(photo) else onOpenAttachment(photo) }, Modifier.fillMaxWidth().height(126.dp), onLongPress = { targetId = photo.id; menu = true }); if (photo.text.isNotBlank()) NativeLinkedText(photo.text); NativeMessageReactions(photo, me, { onAction(photo, "react", it) }, { targetId = photo.id; reactionPicker = true }) } }; if (pair.size == 1) Spacer(Modifier.weight(1f)) } }
            } else {
                if (message.attachmentId != null) when {
                    message.attachmentMime?.startsWith("image/") == true || message.attachmentMime?.startsWith("video/") == true -> AttachmentThumbnail(message, token, { if (selectionMode) onSelect(message) else onOpenAttachment(message) }, Modifier.fillMaxWidth().height(if (sticker) 140.dp else 180.dp), onLongPress = { targetId = message.id; menu = true })
                    message.attachmentMime?.startsWith("audio/") == true -> NativeVoiceMessage(message, token, voicePlayback, { if (selectionMode) onSelect(message) else onPlayAudio(message) }, transcribing, { onAction(message, "transcribe", "") }, isMine)
                    else -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { if (selectionMode) onSelect(message) else onOpenAttachment(message) }, verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Description, null, tint = Accent); Column(Modifier.padding(start = 8.dp)) { NativeText(message.attachmentName.orEmpty(), color = TextMain, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis); NativeText("%.1f МБ".format(message.attachmentSize / 1048576.0), color = Muted, fontSize = 11.sp) } }
                }
                if (message.text.isNotBlank()) NativeLinkedText(message.text, Modifier.padding(top = if (message.attachmentId == null) 0.dp else 5.dp), message.emojiEntities, token, me ?: 0)
                NativeMessageReactions(message, me, { onAction(message, "react", it) }, { reactionPicker = true })
            }
            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                if (!appearance.timeOnTap || detail) { if (group.any { it.edited }) NativeText("изменено · ", color = Muted, fontSize = 10.sp); NativeText(nativeClock(message.createdAt), color = Muted, fontSize = 11.sp); if (isMine) Icon(if (peerDelivered) Icons.Outlined.DoneAll else Icons.Outlined.Done, if (peerRead) "Прочитано" else if (peerDelivered) "Доставлено" else "Отправлено", tint = if (peerRead) Accent else Muted, modifier = Modifier.padding(start = 3.dp).size(15.dp)) }
                DropdownMenu(menu, { menu = false }) {
                    if (!target.deleted) Row(Modifier.padding(horizontal = 4.dp)) { NativeEmoji.take(5).forEach { emoji -> NativeText(emoji, Modifier.size(44.dp).clickable { menu = false; onAction(target, "react", emoji) }.padding(8.dp), fontSize = 22.sp) }; IconButton(onClick = { menu = false; reactionPicker = true }) { Icon(Icons.Outlined.Add, "Другие реакции") } }
                    if (!target.deleted && canReply) DropdownMenuItem(text = { NativeText("Ответить") }, leadingIcon = { Icon(Icons.Outlined.Reply, null) }, onClick = { menu = false; onReply(target) })
                    if (!target.deleted) DropdownMenuItem(text = { NativeText("Переслать") }, leadingIcon = { Icon(Icons.Outlined.ArrowForward, null) }, onClick = { menu = false; onForward(target) })
                    if (target.text.isNotBlank()) DropdownMenuItem(text = { NativeText("Копировать") }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) }, onClick = { menu = false; onCopy(target) })
                    DropdownMenuItem(text = { NativeText("Выбрать") }, leadingIcon = { Icon(Icons.Outlined.CheckCircleOutline, null) }, onClick = { menu = false; onSelect(target) })
                    if (target.senderId == me && !target.deleted && canReply) DropdownMenuItem(text = { NativeText("Изменить") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { menu = false; onEdit(target) })
                    if (canPin && !target.deleted) DropdownMenuItem(text = { NativeText(if (target.pinned) "Открепить" else "Закрепить") }, leadingIcon = { Icon(Icons.Outlined.PushPin, null) }, onClick = { menu = false; onAction(target, "pin", "") })
                    if (target.attachmentId != null && !target.deleted) DropdownMenuItem(text = { NativeText("Открыть или сохранить") }, onClick = { menu = false; onOpenAttachment(target) })
                    if ((target.senderId == me || canModerate) && !target.deleted) DropdownMenuItem(text = { NativeText("Удалить") }, leadingIcon = { Icon(Icons.Outlined.DeleteOutline, null) }, onClick = { menu = false; onAction(target, "delete", "") })
                }
            }
        }
    }
    }
    if (reactionPicker) ModalBottomSheet(onDismissRequest = { reactionPicker = false }, containerColor = Panel) {
        NativeText("Реакция", Modifier.padding(16.dp), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        FlowRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) { NativeEmoji.forEach { emoji -> NativeText(emoji, Modifier.size(48.dp).clip(CircleShape).background(if (target.reactions.any { it.emoji == emoji && it.userId == me }) Hover else Color.Transparent).clickable { onAction(target, "react", emoji); reactionPicker = false }.padding(8.dp), fontSize = 24.sp) } }
        if (target.reactions.isNotEmpty()) TextButton(onClick = { reactionPicker = false; reactionPeople = true }, modifier = Modifier.padding(12.dp)) { NativeText("Кто отреагировал · ${target.reactions.size}") }
        Spacer(Modifier.height(24.dp))
    }
    if (reactionPeople) AlertDialog(onDismissRequest = { reactionPeople = false }, title = { NativeText("Реакции") }, text = { LazyColumn(Modifier.heightIn(max = 350.dp)) { items(target.reactions, key = { "${it.userId}-${it.emoji}" }) { reaction -> NativeText("${reaction.emoji}  ${reaction.name}", Modifier.fillMaxWidth().clickable { reactionPeople = false; onProfile(reaction.userId) }.padding(12.dp), fontSize = 15.sp) } } }, confirmButton = { TextButton(onClick = { reactionPeople = false }) { NativeText("Закрыть") } })
}

@Composable
private fun NativeMessageReactions(message: VolnaMessage, me: Long?, onReact: (String) -> Unit, onLong: () -> Unit) {
    if (message.reactions.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        message.reactions.groupBy { it.emoji }.forEach { (emoji, reactions) ->
            val mine = reactions.any { it.userId == me }
            Box(Modifier.heightIn(min = 44.dp).combinedClickable(onClick = { onReact(emoji) }, onLongClick = onLong), contentAlignment = Alignment.Center) {
                NativeText("$emoji ${reactions.size}", Modifier.clip(CircleShape).background(if (mine) Accent.copy(alpha = .2f) else Hover).border(if (mine) 1.dp else 0.dp, if (mine) Accent else Color.Transparent, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp), color = if (mine) Accent else TextMain, fontSize = 12.sp)
            }
        }
    }
}

@Composable
internal fun NativeLinkedText(text: String, modifier: Modifier = Modifier, entities: List<NativeEmojiEntity> = emptyList(), token: String = "", account: Long = 0) {
    val accent = Accent
    val linked = remember(text, accent) { buildAnnotatedString { append(text); Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE).findAll(text).forEach { match -> addLink(LinkAnnotation.Url(match.value.trimEnd('.', ',', ')'), TextLinkStyles(style = SpanStyle(color = accent, textDecoration = TextDecoration.Underline))), match.range.first, match.range.last + 1) } } }
    if (entities.isEmpty()) NativeText(linked, modifier, color = TextMain, fontSize = 15.sp, lineHeight = 20.sp)
    else {
        val context = LocalContext.current; val api = NativeExpressionHttp.api; val store = remember(account) { NativeExpressionStore(context, account) }
        val builder = androidx.compose.ui.text.AnnotatedString.Builder()
        var cursor = 0
        val inline = mutableMapOf<String, androidx.compose.foundation.text.InlineTextContent>()
        entities.sortedBy { it.start }.forEach { e -> if (e.start >= cursor && e.length > 0 && e.start + e.length <= text.length && e.attachmentId.matches(Regex("[a-f0-9]{48}"))) {
            builder.append(linked.subSequence(cursor, e.start))
            val key = "emoji-${e.start}"; builder.appendInlineContent(key, text.substring(e.start, e.start + e.length))
            inline[key] = androidx.compose.foundation.text.InlineTextContent(androidx.compose.ui.text.Placeholder(1.2.em, 1.2.em, androidx.compose.ui.text.PlaceholderVerticalAlign.TextCenter)) {
                val item = NativeExpression(e.id, "", "emoji", "Пользовательский эмодзи", emptyList(), text.substring(e.start, e.start + e.length), e.attachmentId, e.mime, 0, "")
                NativeExpressionImage(item, token, api, store, Modifier.fillMaxSize(), play = true)
            }; cursor = e.start + e.length
        } }
        builder.append(linked.subSequence(cursor, text.length))
        val annotated = emojiAnnotated(builder.toAnnotatedString(), LocalEmojiCatalog.current, LocalEmojiFont.current)
        androidx.compose.material3.Text(annotated, modifier, color = TextMain, fontSize = 15.sp, lineHeight = 20.sp,
            style = nativeEmojiTextStyle(LocalTextStyle.current), inlineContent = inline)
    }
}
