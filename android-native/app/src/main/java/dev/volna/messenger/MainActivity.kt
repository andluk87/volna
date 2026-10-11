@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package dev.volna.messenger

import android.os.Bundle
import android.content.Intent
import android.content.Context
import android.net.Uri
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.enableEdgeToEdge
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Reply
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.ui.text.AnnotatedString
import android.widget.Toast
import android.media.MediaRecorder
import java.io.File
import java.io.ByteArrayOutputStream
import java.util.UUID
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.collect
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private fun startApkInstaller(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_INSTALL_PACKAGE)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .putExtra(Intent.EXTRA_RETURN_RESULT, true)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(intent)
}
private val QuickEmoji = listOf("👍", "❤️", "😂", "🔥", "🎉", "😮", "😢", "🙏", "👏", "😍", "🤔", "💯", "🥰", "👎", "✨", "💙", "😎", "🤝", "👋", "💪", "😭", "😡", "🤗", "🤣")

class MainActivity : ComponentActivity() {
    private val authReturn = mutableStateOf<String?>(null)
    private val openChatRequest = mutableStateOf<Long?>(null)
    private val openMessageRequest = mutableStateOf<Long?>(null)
    private val openAccountRequest = mutableStateOf<Long?>(null)
    override fun onStart() { super.onStart(); isVisible = true }
    override fun onStop() { isVisible = false; super.onStop() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        configureCallPip()
        authReturn.value = intent?.dataString
        if (intent?.getBooleanExtra("open_call", false) == true) NativeCalls.minimize(false)
        openChatRequest.value = intent?.getLongExtra("chat_id", 0L)?.takeIf { it > 0 }
        openMessageRequest.value = intent?.getLongExtra("message_id", 0L)?.takeIf { it > 0 }
        openAccountRequest.value = intent?.getLongExtra("account_id", 0L)?.takeIf { it > 0 }
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        setContent { NativeEmojiProvider {
            Box(Modifier.fillMaxSize()) {
                VolnaNativeApp(authReturn.value, openChatRequest.value, openMessageRequest.value, openAccountRequest.value) { openChatRequest.value = null; openMessageRequest.value = null; openAccountRequest.value = null }
                if (NativeCallLayout.inPip) { val state by NativeCalls.state.collectAsState(); val account = getSharedPreferences("volna-native", MODE_PRIVATE).getLong("user_id", 0); VolnaTheme(rememberNativeCallAppearance(account)) { NativeCallScreen(state, NativeCredentials.access(account), standalone = true, pip = true) } }
            }
        } }
    }

    override fun onUserLeaveHint() { super.onUserLeaveHint(); enterCallPip() }
    override fun onPictureInPictureModeChanged(inPip: Boolean, config: android.content.res.Configuration) { super.onPictureInPictureModeChanged(inPip, config); NativeCallLayout.inPip = inPip }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        authReturn.value = intent.dataString
        if (intent.getBooleanExtra("open_call", false)) NativeCalls.minimize(false)
        openChatRequest.value = intent.getLongExtra("chat_id", 0L).takeIf { it > 0 }
        openMessageRequest.value = intent.getLongExtra("message_id", 0L).takeIf { it > 0 }
        openAccountRequest.value = intent.getLongExtra("account_id", 0L).takeIf { it > 0 }
    }

    companion object { @Volatile var isVisible: Boolean = false; @Volatile var visibleChatId: Long = 0 }
}

@Composable
private fun VolnaNativeApp(authReturnUrl: String?, openChatId: Long?, openMessageId: Long?, openAccountId: Long?, onIntentConsumed: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val api = remember { NativeApi(BuildConfig.API_BASE_URL) }
    val cache = remember { NativeCache(context) }
    DisposableEffect(cache) { onDispose { cache.close() } }
    val prefs = remember { context.getSharedPreferences("volna-native", 0) }
    val appearanceAccount = prefs.getLong("user_id", 0)
    val appearancePrefs = remember(appearanceAccount) { context.getSharedPreferences("volna-appearance-$appearanceAccount", 0) }
    var appearance by remember(appearanceAccount) { mutableStateOf(NativeAppearance.load(if (appearancePrefs.all.isEmpty()) context.getSharedPreferences("volna-appearance", 0) else appearancePrefs)) }
    val themeStore = remember(appearanceAccount) { NativeThemeStore(context, appearanceAccount) }
    var themeRevision by remember(appearanceAccount) { mutableStateOf(0) }
    var appearanceChat by remember { mutableStateOf<Long?>(null) }
    val sendNonces = remember { mutableMapOf<String, String>() }
    var appearanceOpen by remember { mutableStateOf(false) }
    LaunchedEffect(appearanceAccount) { appearanceOpen = false; appearanceChat = null }
    var communityEntry by remember { mutableStateOf<String?>(null) }
    var topicsGroup by remember { mutableStateOf<VolnaChat?>(null) }
    var manageCommunity by remember { mutableStateOf<VolnaChat?>(null) }
    var galleryChat by remember { mutableStateOf<VolnaChat?>(null) }
    var attachmentPreview by remember { mutableStateOf<VolnaMessage?>(null) }
    val callState by NativeCalls.state.collectAsState()
    val callDiagnosticReport by NativeCallDiagnostics.report.collectAsState()
    var callDiagnosticsOpen by remember { mutableStateOf(false) }
    var pendingCall by remember { mutableStateOf<VolnaChat?>(null) }
    var pendingVideoChat by remember { mutableStateOf<VolnaChat?>(null) }
    val scope = rememberCoroutineScope()
    val homeState = rememberSaveableStateHolder()
    var token by remember { mutableStateOf(NativeCredentials.access(prefs.getLong("user_id",0))) }
    var me by remember { mutableStateOf<VolnaUser?>(null) }
    NativeContactSyncHost(me?.id ?: 0, token, api)
    val contactNames = rememberNativeContactNames(me?.id ?: 0)
    val chats = remember { mutableStateListOf<VolnaChat>() }
    val messages = remember { mutableStateListOf<VolnaMessage>() }
    val messageSearchResults = remember { mutableStateListOf<VolnaMessage>() }
    val pinnedMessages = remember { mutableStateListOf<VolnaMessage>() }
    val transcribingMessages = remember { mutableStateListOf<Long>() }
    var selectedChat by remember { mutableStateOf<VolnaChat?>(null) }
    LaunchedEffect(contactNames) {
        chats.indices.forEach { index -> val row = chats[index]; val alias = contactNames[row.peerId]; if (row.kind == "direct" && alias != null && alias != row.name) chats[index] = row.copy(name = alias) }
        selectedChat?.let { row -> contactNames[row.peerId]?.let { selectedChat = row.copy(name = it) } }
    }
    androidx.compose.runtime.SideEffect { MainActivity.visibleChatId = selectedChat?.id ?: 0 }
    var moreHistory by remember { mutableStateOf(false) }
    var retryGeneration by remember { mutableStateOf(0) }
    var focusMessageId by remember { mutableStateOf<Long?>(null) }
    var profileSearchRequested by remember { mutableStateOf(false) }
    var earlierWindow by remember(selectedChat?.id) { mutableStateOf(false) }
    var loadingHistory by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var messageQuery by remember { mutableStateOf("") }
    var forwardTargetMessage by remember { mutableStateOf<VolnaMessage?>(null) }
    var forwardBatch by remember { mutableStateOf(emptyList<VolnaMessage>()) }
    var forwardNonce by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var extraAttachment by remember { mutableStateOf("") }
    var visibleReadId by remember(selectedChat?.id) { mutableStateOf(0L) }
    var people by remember { mutableStateOf(emptyList<VolnaUser>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var qrOpen by remember { mutableStateOf(false) }
    var initialQr by remember { mutableStateOf("") }
    var profileRevision by remember { mutableStateOf(0) }
    var profileTargetId by remember { mutableStateOf<Long?>(null) }
    var updateAvailable by remember { mutableStateOf<VolnaUpdate?>(null) }
    var dismissedUpdate by remember { mutableStateOf<Long?>(null) }
    var updateBusy by remember { mutableStateOf(false) }
    var updateStatus by remember { mutableStateOf("") }
    var pendingUpdateFile by remember { mutableStateOf<File?>(null) }
    val voicePlayback = remember { NativeVoicePlayback(context) { error = it } }
    var attachmentBatch by remember { mutableStateOf<NativeAttachmentBatch?>(null) }
    var attachmentSending by remember { mutableStateOf(false) }
    var attachmentStatus by remember { mutableStateOf("") }
    var attachmentError by remember { mutableStateOf("") }
    var pickedChat by remember { mutableStateOf<Long?>(null) }
    var pickedCaption by remember { mutableStateOf("") }
    var pickedReply by remember { mutableStateOf<Long?>(null) }
    var pickedOnSent by remember { mutableStateOf<(() -> Unit)?>(null) }
    var pickedKind by remember { mutableStateOf("file") }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val callPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) pendingCall?.let { voicePlayback.stop(); NativeCalls.start(it) } else error = "Разрешите микрофон для звонка"
        pendingCall = null
    }
    val videoPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val chat = pendingVideoChat; pendingVideoChat = null
        if (chat != null && granted[Manifest.permission.RECORD_AUDIO] == true && granted[Manifest.permission.CAMERA] == true) { voicePlayback.stop(); NativeCalls.start(chat, video = true) }
        else error = "Разрешите микрофон и камеру для видеозвонка"
    }
    val startVideo: (VolnaChat) -> Unit = { chat ->
        if (callState.call != null) NativeCalls.minimize(false)
        else { pendingVideoChat = chat; videoPermission.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)) }
    }
    val installPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val file = pendingUpdateFile
        if (file != null && Build.VERSION.SDK_INT >= 26 && context.packageManager.canRequestPackageInstalls()) {
            try { startApkInstaller(context, file); updateStatus = "Подтвердите установку в окне Android" }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { updateStatus = problem.message ?: "Не удалось открыть установщик Android" }
        } else updateStatus = "Разрешите установку приложений для Волны и нажмите «Обновить» ещё раз"
    }
    val installUpdate: (VolnaUpdate?) -> Unit = { release ->
        if (callState.call != null || attachmentSending) updateStatus = "Завершите звонок или отправку вложения перед обновлением"
        else if (release != null && !updateBusy) scope.launch {
            updateBusy = true; updateStatus = "Скачиваем Волна ${release.versionName}…"
            try {
                val file = File(context.filesDir, "updates/volna-${release.versionCode}.apk")
                withContext(Dispatchers.IO) { api.downloadUpdate(release, file) }
                pendingUpdateFile = file
                if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
                    updateStatus = "Разрешите установку приложений для Волны"
                    installPermission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                } else {
                    startApkInstaller(context, file); updateStatus = "Подтвердите установку в окне Android"
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { updateStatus = problem.message ?: "Не удалось установить обновление" }
            finally { updateBusy = false }
        }
    }
    DisposableEffect(Unit) { onDispose { voicePlayback.close() } }
    LaunchedEffect(token, selectedChat?.id) { voicePlayback.stop() }
    LaunchedEffect(callState.call?.id) {
        if (callState.call != null) voicePlayback.stop()
    }
    fun prepareAttachments(uris: List<Uri>) {
        val chatId = pickedChat ?: return
        if (uris.isNotEmpty() && token.isNotBlank() && selectedChat?.id == chatId) scope.launch {
            busy = true; error = ""
            try {
                val files = withContext(Dispatchers.IO) { selectedAttachments(context.contentResolver, uris) }.map { file ->
                    if (pickedKind == "sticker") file.copy(name = "Стикер-${file.name}", mime = "image/webp") else file
                }
                if (selectedChat?.id != chatId) throw IllegalStateException("Чат изменился. Выберите вложения ещё раз.")
                attachmentBatch = NativeAttachmentBatch(chatId, files, pickedCaption, pickedReply, pickedOnSent ?: {})
                attachmentError = ""; attachmentStatus = ""
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось выбрать вложения" }
            finally { busy = false }
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents(), ::prepareAttachments)
    val mediaPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10), ::prepareAttachments)
    val cameraPicker = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        cameraUri?.let { uri -> if (saved) prepareAttachments(listOf(uri)) else runCatching { context.contentResolver.delete(uri, null, null) } }; cameraUri = null
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) cameraUri?.let { cameraPicker.launch(it) } else error = "Разрешите доступ к камере"
    }
    fun discardBatch(batch: NativeAttachmentBatch) {
        val session = token
        scope.launch(Dispatchers.IO) { NativeVoiceOutbox.remove(batch); batch.uploads.values.forEach { id -> runCatching { api.discardAttachment(session, id) } } }
        attachmentBatch = null; attachmentError = ""
    }
    fun sendBatch(batch: NativeAttachmentBatch, caption: String) {
        if (attachmentSending || token.isBlank()) return
        val session = token
        batch.caption = batch.caption ?: caption
        val text = batch.caption.orEmpty()
        attachmentSending = true; busy = true; attachmentError = ""
        scope.launch {
            try {
                withContext(Dispatchers.IO) { NativeVoiceOutbox.save(batch) }
                batch.files.forEachIndexed { index, file ->
                    attachmentStatus = "Загрузка ${index + 1} из ${batch.files.size}"
                    if (batch.uploads[index] == null) batch.uploads[index] = withContext(Dispatchers.IO) {
                        api.upload(session, file.name, file.mime, readAttachment(context.contentResolver, file.uri))
                    }
                    withContext(Dispatchers.IO) { NativeVoiceOutbox.save(batch) }
                }
                attachmentStatus = "Отправляем…"
                val ids = batch.files.indices.map { batch.uploads.getValue(it) }
                val album = ids.size > 1 && batch.files.all { it.mime.startsWith("image/") || it.mime.startsWith("video/") }
                val created = withContext(Dispatchers.IO) {
                    if (album) api.sendAlbum(session, batch.chatId, ids, text, batch.replyId, batch.clientId)
                    else ids.mapIndexed { index, id -> api.send(session, batch.chatId, if (index == 0) text else "", batch.replyId, id, batch.clientId + "-" + index) }
                }
                if (token == session && selectedChat?.id == batch.chatId) {
                    if (earlierWindow) { earlierWindow = false; messages.clear() }
                    focusMessageId = created.lastOrNull()?.id
                    created.forEach { message -> if (messages.none { it.id == message.id }) messages.add(message) }
                    batch.onSent()
                }
                withContext(Dispatchers.IO) { NativeVoiceOutbox.remove(batch) }
                if (token == session) attachmentBatch = null
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { attachmentError = problem.message ?: "Не удалось отправить вложения. Повторите отправку." }
            finally { attachmentSending = false; busy = false }
        }
    }
    val sendVoice: (File, Long?, () -> Unit) -> Unit = { file, replyId, onSent ->
        val chat = selectedChat
        val account = me
        if (chat == null || account == null || token.isBlank() || attachmentBatch != null) { file.delete(); error = "Не удалось подготовить запись. Повторите запись в открытом чате." }
        else {
            val batch = NativeVoiceOutbox.batch(context, account.id, chat.id, file, replyId, onSent)
            attachmentBatch = batch; attachmentError = ""; attachmentStatus = "Отправляем голосовое…"
            sendBatch(batch, "")
        }
    }
    LaunchedEffect(token, me?.id) {
        val account = me?.id ?: return@LaunchedEffect
        if (token.isNotBlank() && attachmentBatch == null) {
            val recovered = withContext(Dispatchers.IO) { NativeVoiceOutbox.load(context, account) }
            if (recovered != null) { attachmentBatch = recovered; attachmentError = "Предыдущая запись ещё не отправлена" }
        }
    }

    LaunchedEffect(openChatId, openAccountId, chats.toList()) {
        if (openChatId == null) return@LaunchedEffect
        if (openAccountId != null && openAccountId != me?.id) {
            val account = NativeAccounts.list(context).firstOrNull { it.user.id == openAccountId }
            if (account != null && account.token != token && callState.call == null && !attachmentSending) {
                MessagingService.stop(context); messages.clear(); chats.clear(); selectedChat = null
                attachmentBatch = null; attachmentError = ""
                prefs.edit().remove("token").putLong("user_id", account.user.id).apply(); me = account.user; token = account.token
            }
            return@LaunchedEffect
        }
        val target = chats.firstOrNull { it.id == openChatId }
        if (target != null) { selectedChat = target; messages.clear(); focusMessageId = openMessageId; onIntentConsumed() }
    }
    LaunchedEffect(token) {
        MessagingService.events.collect { event ->
            if (event.account != me?.id || event.message.chatId != selectedChat?.id) return@collect
            val position = messages.indexOfFirst { it.id == event.message.id }
            if (position >= 0) messages[position] = event.message
            else if (event.type == "message" && !earlierWindow) { messages.add(event.message); messages.sortBy { it.id }; while (messages.size > 1000) messages.removeAt(0) }
        }
    }

    LaunchedEffect(token) {
        MessagingService.signals.collect { event ->
            if(event.account!=me?.id)return@collect
            if(event.type=="removed"&&topicsGroup?.id==event.chatId)topicsGroup=null
            if(event.type=="removed"&&(selectedChat?.id==event.chatId||selectedChat?.parentId==event.chatId)){selectedChat=null;messages.clear();topicsGroup=null}
            if(event.type=="profile") {
                profileRevision++
                if(event.userId==me?.id)try{val user=withContext(Dispatchers.IO){api.me(token)};me=user;NativeAccounts.remember(context,user,token);withContext(Dispatchers.IO){cache.saveMe(user)}}catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){}
            }
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            try { updateAvailable = withContext(Dispatchers.IO) { api.checkUpdate(BuildConfig.VOLNA_VERSION_CODE) } }
            catch (_: Exception) { /* Offline, or the update manifest is not published yet. */ }
            delay(15 * 60 * 1000L)
        }
    }

    LaunchedEffect(token) { NativeCalls.configure(context, token) }
    LaunchedEffect(authReturnUrl, token) {
        if (!authReturnUrl.isNullOrBlank() && authReturnUrl.startsWith("volna://profile/") && token.isNotBlank()) {
            try { val nick=android.net.Uri.parse(authReturnUrl).path.orEmpty().trim('/');if(nick.matches(Regex("[a-zA-Z0-9_]{4,32}"))){val user=withContext(Dispatchers.IO){api.publicProfile(nick)};profileTargetId=user.id} } catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()};onIntentConsumed()
        }
        if (!authReturnUrl.isNullOrBlank() && authReturnUrl.startsWith("volna://login/") && token.isNotBlank()) { initialQr = authReturnUrl; qrOpen = true; onIntentConsumed() }
    }

    LaunchedEffect(token) {
        if (token.isBlank()) {
            MessagingService.stop(context)
            profileTargetId = null; appearanceOpen = false; communityEntry = null
            manageCommunity = null; topicsGroup = null; galleryChat = null; attachmentPreview = null
            voicePlayback.stop()
            me = null
            qrOpen = false
            chats.clear()
            messages.clear()
            selectedChat = null
            return@LaunchedEffect
        }
        val cachedUser = withContext(Dispatchers.IO) { cache.me(prefs.getLong("user_id", 0)) }
        if (cachedUser != null) {
            me = cachedUser
            chats.clear(); chats.addAll(withContext(Dispatchers.IO) { cache.chats(cachedUser.id).map { row -> row.copy(name = if (row.kind == "direct") contactNames[row.peerId] ?: row.name else row.name) } })
            MessagingService.start(context, token, cachedUser.id)
        }
        try {
            me = withContext(Dispatchers.IO) { api.me(token) }
            me?.let { prefs.edit().putLong("user_id", it.id).apply(); NativeAccounts.remember(context, it, token); withContext(Dispatchers.IO) { cache.saveMe(it) }; MessagingService.start(context, token, it.id) }
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) {
            error = problem.message ?: "Не удалось подключиться к Волна"
            if (problem is NativeApiException && problem.status == 401 || error.contains("Войдите", true) || error.contains("401")) {
                me?.id?.let { NativeAccounts.remove(context, it) }
                prefs.edit().remove("token").apply()
                token = ""
            }
        }
    }

    LaunchedEffect(token, me?.id) {
        if (token.isNotBlank() && me != null) MessagingService.start(context, token, me!!.id)
    }

    LaunchedEffect(token, selectedChat?.id, me?.id, retryGeneration) {
        if (token.isBlank()) return@LaunchedEffect
        moreHistory = false; loadingHistory = false
        var lastReadMessageId = 0L
        val account = me?.id ?: prefs.getLong("user_id", 0)
        selectedChat?.id?.let { id -> if (messages.isEmpty()) messages.addAll(withContext(Dispatchers.IO) { cache.messages(account, id) }) }
        while (true) {
            if (!MainActivity.isVisible) { delay(1500); continue }
            try {
                val rows = withContext(Dispatchers.IO) { api.chats(token) }
                if (chats.toList() != rows) { chats.clear(); chats.addAll(rows) }
                withContext(Dispatchers.IO) { cache.saveChats(account, rows); NativeNotificationPolicy.muted(context, account, rows) }
                selectedChat?.let { selectedChat = rows.firstOrNull { row -> row.id == it.id } }
                val current = selectedChat
                if (current != null) {
                    val fresh = withContext(Dispatchers.IO) { api.messages(token, current.id, if (earlierWindow) messages.lastOrNull()?.id?.plus(1) else null) }
                    moreHistory = fresh.size == 50
                    val retained = fresh.firstOrNull()?.id?.let { first -> messages.filter { it.id < first } } ?: emptyList()
                    val merged = (if (fresh.any { row -> messages.any { it.id == row.id } }) retained + fresh else fresh).distinctBy { it.id }.takeLast(1000)
                    if (messages.toList() != merged) { messages.clear(); messages.addAll(merged) }
                    if (!earlierWindow) withContext(Dispatchers.IO) { cache.saveMessages(account, current.id, merged) }
                    val latest = fresh.lastOrNull()
                    if (!earlierWindow && latest != null && me != null && latest.senderId != me?.id && latest.id > lastReadMessageId) {
                        withContext(Dispatchers.IO) { api.markDelivered(token, current.id, latest.id) }
                        lastReadMessageId = latest.id
                    }
                }
                error = ""
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) {
                error = problem.message ?: "Проверьте соединение с сервером"
                if (problem is NativeApiException && problem.status == 401) { me?.id?.let { NativeAccounts.remove(context, it) }; prefs.edit().remove("token").apply(); token = ""; return@LaunchedEffect }
            }
            delay(if (appearance.powerSaving) 7500 else 3500)
        }
    }

    LaunchedEffect(token, selectedChat?.id, messageQuery) {
        val chatId = selectedChat?.id
        if (token.isBlank() || chatId == null || messageQuery.trim().length < 2) {
            messageSearchResults.clear()
            return@LaunchedEffect
        }
        delay(250)
        try {
            val found = withContext(Dispatchers.IO) { api.searchMessages(token, chatId, messageQuery.trim()) }
            messageSearchResults.clear(); messageSearchResults.addAll(found)
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Поиск сообщений недоступен" }
    }

    LaunchedEffect(token, selectedChat?.id) {
        val chatId = selectedChat?.id
        if (token.isBlank() || chatId == null) { pinnedMessages.clear(); return@LaunchedEffect }
        try {
            val pinned = withContext(Dispatchers.IO) { api.pinnedMessages(token, chatId) }
            pinnedMessages.clear(); pinnedMessages.addAll(pinned)
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить закреплённые" }
    }

    LaunchedEffect(query, token) {
        if (token.isBlank() || query.trim().length < 2) { people = emptyList(); return@LaunchedEffect }
        delay(250)
        try { people = withContext(Dispatchers.IO) { api.searchPeople(token, query.trim()) } }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Поиск недоступен" }
    }

    VolnaTheme(appearance) {
            Surface(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout)), color = Ink) {
            Column(Modifier.fillMaxSize()) {
            if (attachmentSending && attachmentBatch?.voiceFile != null) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent)
            if (callState.call != null && callState.minimized) NativeCallScreen(callState, token)
            if ((callState.error.isNotBlank() || callDiagnosticReport.isNotBlank()) && callState.call == null) Column {
                ErrorBanner(callState.error.ifBlank { "Прошлый звонок был прерван. Сохранена диагностика запуска." }, Modifier.fillMaxWidth())
                Row {
                    if (callDiagnosticReport.isNotBlank()) TextButton(onClick = { callDiagnosticsOpen = true }) { NativeText("Диагностика звонка") }
                    TextButton(onClick = NativeCalls::clearError) { NativeText("Закрыть") }
                }
            }
            Box(Modifier.weight(1f)) {
            when {
                token.isBlank() -> NativeSmsLogin(api, updateAvailable, updateBusy, updateStatus,
                    { installUpdate(updateAvailable) }) { session ->
                        prefs.edit().remove("token").putLong("user_id",session.user.id).apply()
                        NativeAccounts.remember(context,session.user,session.token);me=session.user;token=session.token
                        if(session.user.username==session.user.phone.filter { it.isDigit() })profileTargetId=session.user.id
                    }
                selectedChat == null -> homeState.SaveableStateProvider("home-${me?.id ?: 0}") { ChatListScreen(
                    user = me, chats = chats.filter { it.parentId == 0L }, query = query, people = people, token = token,
                    error = error,
                    api = api, cache = cache,
                    onRetry = { retryGeneration++ },
                    onAppearanceChange = { appearance = it; it.save(appearancePrefs) },
                    onSearchMessage = { message -> selectedChat = chats.firstOrNull { it.id == message.chatId }; messages.clear(); focusMessageId = message.id },
                    onSwitchAccount = { account ->
                        if (callState.call != null || attachmentSending) error = "Завершите звонок или дождитесь отправки перед переключением аккаунта"
                        else {
                            MessagingService.stop(context); selectedChat = null; messages.clear(); chats.clear(); me = account?.user
                            profileTargetId = null; manageCommunity = null; topicsGroup = null; galleryChat = null; attachmentPreview = null; forwardTargetMessage = null; attachmentBatch = null
                            prefs.edit().remove("token").putLong("user_id", account?.user?.id ?: 0).apply()
                            token = account?.token.orEmpty(); error = ""; query = ""; qrOpen = false
                        }
                    },
                    onVideo = startVideo,
                    onCall = { chat ->
                        if (callState.call != null) NativeCalls.minimize(false)
                        else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { voicePlayback.stop(); NativeCalls.start(chat) }
                        else { pendingCall = chat; callPermission.launch(Manifest.permission.RECORD_AUDIO) }
                    },
                    update = updateAvailable, updateBusy = updateBusy, updateStatus = updateStatus,
                    onUpdate = { installUpdate(updateAvailable) }, onScanQr = { if (callState.call == null) { initialQr = ""; qrOpen = true } else error = "Завершите звонок перед сканированием" },
                    onOpenProfile = { profileTargetId = it },
                    onAppearance = { appearanceChat = null; appearanceOpen = true }, onCommunityEntry = { communityEntry = it },
                    onSavedMessages = {
                        scope.launch { try {
                            val id = withContext(Dispatchers.IO) { api.savedChat(token) }
                            chats.clear(); chats.addAll(withContext(Dispatchers.IO) { api.chats(token) })
                            selectedChat = chats.firstOrNull { it.id == id }; messages.clear()
                        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть избранное" } }
                    },
                    onQuery = { query = it },
                    onSelect = { chat -> selectedChat = chat; messages.clear(); messageQuery = ""; focusMessageId = null },
                    onChatPreference = { chat, key, value ->
                        scope.launch {
                            try { withContext(Dispatchers.IO) { api.updateChatPreference(token, chat.id, key, value) }; chats.clear(); chats.addAll(withContext(Dispatchers.IO) { api.chats(token) }) }
                            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось изменить чат" }
                        }
                    },
                    onStartChat = { person ->
                        scope.launch {
                            try {
                                busy = true
                                val id = withContext(Dispatchers.IO) { api.startChat(token, person.id) }
                                selectedChat = chats.firstOrNull { it.id == id } ?: VolnaChat(id, person.name, person.username, "", "", 0, false, person.id)
                                query = ""; people = emptyList()
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть чат" }
                            finally { busy = false }
                        }
                    },
                    onLogout = {
                        if (callState.call != null || attachmentSending) { error = "Завершите звонок или дождитесь отправки перед выходом"; return@ChatListScreen }
                        val session = token; val account = me?.id
                        scope.launch { try { withContext(Dispatchers.IO) { api.logout(session) } } catch (_: Exception) { }
                            account?.let { id -> NativeAccounts.remove(context, id); withContext(Dispatchers.IO) { cache.clear(id); NativeVoiceOutbox.clear(context, id) }; NativeDrafts(context, id).clear() }
                            if (token == session) {
                                MessagingService.stop(context); NativeCalls.configure(context, ""); attachmentBatch = null; selectedChat = null
                                prefs.edit().remove("token").remove("user_id").apply(); token = ""; error = ""
                            } }
                    }
                ) }
                else -> {
                    val individual = remember(selectedChat!!.id, themeRevision, appearanceAccount) { themeStore.chat(selectedChat!!.id) }
                    VolnaTheme(if (individual == null) appearance else appearance.copy(design = individual, radius = individual.radius)) {
                    ChatRoomScreen(
                    user = me, chat = selectedChat!!, messages = messages.toList(), busy = busy,
                    searchQuery = messageQuery, searchResults = messageSearchResults.toList(), pinnedMessages = pinnedMessages.toList(),
                    onSearch = { messageQuery = it }, onForward = { forwardTargetMessage = it; forwardBatch = listOf(it); forwardNonce = UUID.randomUUID().toString() },
                    onForwardMany = { batch -> if (batch.isNotEmpty()) { forwardBatch = batch; forwardTargetMessage = batch.first(); forwardNonce = UUID.randomUUID().toString() } },
                    onVisibleMessage = { id ->
                        val chatId = selectedChat!!.id
                        if (id > visibleReadId) { visibleReadId = id; scope.launch { try { withContext(Dispatchers.IO) { api.markRead(token, chatId, id) } } catch (_: Exception) { visibleReadId = 0L } } }
                    },
                    onOpenProfile = { profileTargetId = it },
                    onRetry = { retryGeneration++ }, focusMessageId = focusMessageId, onFocusConsumed = { focusMessageId = null },
                    onJumpToMessage = { id ->
                        val chatId = selectedChat!!.id
                        scope.launch {
                            try { val page = withContext(Dispatchers.IO) { api.messagesAround(token, chatId, id) }; if (selectedChat?.id == chatId) { earlierWindow = true; messages.clear(); messages.addAll(page); focusMessageId = id } }
                            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Сообщение недоступно" }
                        }
                    },
                    startSearch = profileSearchRequested, onSearchStarted = { profileSearchRequested = false },
                    earlierWindow = earlierWindow, onNewest = { earlierWindow = false; messages.clear(); focusMessageId = selectedChat?.lastId?.takeIf { it > 0 }; retryGeneration++ },
                    token = token, callActive = callState.call != null,
                    transcribingMessages = transcribingMessages.toSet(),
                    moreHistory = moreHistory, loadingHistory = loadingHistory, onLoadOlder = {
                        val chatId = selectedChat?.id
                        val before = messages.firstOrNull()?.id
                        if (chatId != null && before != null && !loadingHistory) scope.launch {
                            loadingHistory = true
                            try {
                                val page = withContext(Dispatchers.IO) { api.messages(token, chatId, before) }
                                if (selectedChat?.id == chatId) { messages.addAll(0, page.filter { row -> messages.none { it.id == row.id } }); if (messages.size > 1000) { earlierWindow = true; while (messages.size > 1000) messages.removeAt(messages.lastIndex) }; moreHistory = page.size == 50 }
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить историю" }
                            finally { if (selectedChat?.id == chatId) loadingHistory = false }
                        }
                    },
                    onVideo = startVideo,
                    onCall = { chat ->
                        if (callState.call != null) NativeCalls.minimize(false)
                        else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { voicePlayback.stop(); NativeCalls.start(chat) }
                        else { pendingCall = chat; callPermission.launch(Manifest.permission.RECORD_AUDIO) }
                    },
                    onCommunity = { if(selectedChat?.parentId != 0L && selectedChat?.parentId != null) topicsGroup=chats.firstOrNull { it.id==selectedChat?.parentId } else manageCommunity = selectedChat },
                    onTopics = { topicsGroup=chats.firstOrNull { it.id==(selectedChat?.parentId?.takeIf { id -> id != 0L } ?: selectedChat?.id) } }, onGallery = { galleryChat = selectedChat },
                    onOpenAttachment = { attachmentPreview = it },
                    error = error,
                    onBack = { selectedChat = selectedChat?.parentId?.takeIf { it != 0L }?.let { parent -> chats.firstOrNull { it.id==parent } }; messages.clear(); messageQuery = "" },
                    api = api,
                    onAppearance = { appearanceChat = selectedChat?.id; appearanceOpen = true },
                    onSendExpression = { item, replyId, onSent ->
                        val chatId = selectedChat!!.id; val session = token
                        val key = "$appearanceAccount:$chatId:${item.id}:$replyId"
                        val nonce = sendNonces.getOrPut(key) { UUID.randomUUID().toString() }
                        scope.launch {
                            busy = true; error = ""
                            try {
                                val created = withContext(Dispatchers.IO) { api.send(session, chatId, "", replyId, clientId = nonce, expressionId = item.id) }
                                sendNonces.remove(key)
                                if (token == session && selectedChat?.id == chatId) { if (earlierWindow) { earlierWindow = false; messages.clear() }; if (messages.none { it.id == created.id }) messages.add(created); focusMessageId = created.id; onSent() }
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { if (token == session) error = problem.message ?: "Не удалось отправить" } finally { busy = false }
                        }
                    },
                    onSend = { text, replyId, entities, editId, onSent ->
                        val chatId = selectedChat!!.id
                        val session = token
                        scope.launch {
                            busy = true
                            try {
                                val key = "$appearanceAccount:$chatId:$replyId:${text.hashCode()}:${entities.hashCode()}"
                                val nonce = sendNonces.getOrPut(key) { UUID.randomUUID().toString() }
                                val created = withContext(Dispatchers.IO) { if (editId != null) api.updateRichMessage(session, editId, text, entities) else api.send(session, chatId, text, replyId, clientId = nonce, emojiEntities = entities) }
                                sendNonces.remove(key)
                                if (editId != null && token == session && selectedChat?.id == chatId) { val position = messages.indexOfFirst { it.id == created.id }; if (position >= 0) messages[position] = created }
                                if (token == session && selectedChat?.id == chatId) { if (earlierWindow) { earlierWindow = false; messages.clear() }; if (messages.none { it.id == created.id }) messages.add(created); focusMessageId = created.id; onSent() }
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось отправить сообщение" }
                            finally { busy = false }
                        }
                    },
                    onPickFiles = { media, caption, replyId, onSent ->
                        pickedChat = selectedChat?.id; pickedCaption = caption; pickedReply = replyId; pickedOnSent = onSent; pickedKind = "file"
                        if (media) mediaPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) else filePicker.launch("*/*")
                    },
                    onPickExtra = { kind, caption, replyId, onSent ->
                        pickedChat = selectedChat?.id; pickedCaption = caption; pickedReply = replyId; pickedOnSent = onSent; pickedKind = kind
                        when (kind) {
                            "music" -> filePicker.launch("audio/*")
                            "sticker" -> filePicker.launch("image/webp")
                            "gif" -> filePicker.launch("image/gif")
                            "camera" -> {
                                val file = File(context.cacheDir, "attachments/camera/${UUID.randomUUID()}.jpg"); file.parentFile?.mkdirs()
                                cameraUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) cameraPicker.launch(cameraUri!!)
                                else cameraPermission.launch(Manifest.permission.CAMERA)
                            }
                            else -> extraAttachment = kind
                        }
                    },
                    onSendVoice = sendVoice,
                    onPlayAudio = { message ->
                        if (callState.call != null) { error = "Аудиосообщения доступны после завершения звонка"; return@ChatRoomScreen }
                        voicePlayback.toggle(token, message)
                    },
                    voicePlayback = voicePlayback,
                    onMessageAction = { message, action, value ->
                        val chatId = selectedChat!!.id
                        val session = token
                        if (action == "transcribe") transcribingMessages.add(message.id)
                        scope.launch {
                            try {
                                val updated = withContext(Dispatchers.IO) {
                                    when (action) {
                                        "edit" -> api.updateMessage(session, message.id, value)
                                        "delete" -> api.deleteMessage(session, message.id)
                                        "pin" -> api.pin(session, message.id, !message.pinned)
                                        "transcribe" -> message.copy(transcript = api.transcribe(session, message.id))
                                        "react" -> api.react(session, message.id, value, message.reactions.none { it.emoji == value && it.userId == me?.id })
                                        else -> message
                                    }
                                }
                                if (token != session || selectedChat?.id != chatId) return@launch
                                if (action == "transcribe") error = ""
                                listOf(messages, messageSearchResults, pinnedMessages).forEach { list ->
                                    val position = list.indexOfFirst { it.id == updated.id }
                                    if (position >= 0) { if (list === pinnedMessages && (updated.deleted || !updated.pinned)) list.removeAt(position) else list[position] = updated }
                                }
                                if (action == "pin") {
                                    val refreshedPins = withContext(Dispatchers.IO) { api.pinnedMessages(token, chatId) }
                                    pinnedMessages.clear(); pinnedMessages.addAll(refreshedPins)
                                }
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Действие не выполнено" }
                            finally { if (action == "transcribe") transcribingMessages.remove(message.id) }
                        }
                    }
                )
                } }
            }
            }
            }
            if (qrOpen && token.isNotBlank()) NativeQrScanner(token, api, initialQr) { qrOpen = false; initialQr = "" }
            profileTargetId?.let { profileId ->
                NativeProfileDialog(
                    userId = profileId, currentUser = me, token = token, api = api, cache = cache, chats = chats.toList(), refresh = profileRevision,
                    onDismiss = { profileTargetId = null },
                    onAppearance = { chat -> appearanceChat = chat.id; appearanceOpen = true },
                    onOpenAttachment = { attachmentPreview = it },
                    onOpenChat = { chat, search -> profileTargetId = null; selectedChat = chat; messages.clear(); profileSearchRequested = search },
                    onMute = { chat -> scope.launch { try { withContext(Dispatchers.IO) { api.updateChatPreference(token, chat.id, "muted", !chat.muted) }; val rows = withContext(Dispatchers.IO) { api.chats(token) }; chats.clear(); chats.addAll(rows) } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось изменить уведомления" } } },
                    onVideo = startVideo,
                    onCall = { chat -> profileTargetId = null; if (callState.call != null) NativeCalls.minimize(false) else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { voicePlayback.stop(); NativeCalls.start(chat) } else { pendingCall = chat; callPermission.launch(Manifest.permission.RECORD_AUDIO) } },
                    onStartChat = { person, call -> scope.launch { try {
                        val id = withContext(Dispatchers.IO) { api.startChat(token, person.id) }
                        val chat = VolnaChat(id, person.name, person.username, "", "", 0, false, person.id, avatarUrl = person.avatarUrl)
                        profileTargetId = null; selectedChat = chat; messages.clear()
                        if (call) { if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { voicePlayback.stop(); NativeCalls.start(chat) } else { pendingCall = chat; callPermission.launch(Manifest.permission.RECORD_AUDIO) } }
                    } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть чат" } } },
                    onSaved = { updated -> if (updated.id == me?.id) { val saved = updated; me = saved; NativeAccounts.remember(context, saved, token); scope.launch(Dispatchers.IO) { cache.saveMe(saved) } } }
                )
            }
            if (appearanceOpen) {
                val individual = appearanceChat?.let { remember(it, themeRevision, appearanceAccount) { themeStore.chat(it) } }
                AppearanceDialog(if (individual == null) appearance else appearance.copy(design = individual, radius = individual.radius),
                    { updated -> if (appearanceChat == null) { appearance = updated; updated.save(appearancePrefs) } else { appearance = appearance.copy(font = updated.font, textScale = updated.textScale, uiScale = updated.uiScale, density = updated.density); appearance.save(appearancePrefs); themeStore.setChat(appearanceChat!!, updated.design); themeRevision++ } },
                    { appearanceOpen = false }, appearanceAccount, appearanceChat,
                    if (appearanceChat == null) null else ({ themeStore.setChat(appearanceChat!!, null); themeRevision++ }))
            }
            communityEntry?.let { mode -> CommunityEntryDialog(mode, token, api, { communityEntry = null }) { id ->
                communityEntry = null
                scope.launch { try { chats.clear(); chats.addAll(withContext(Dispatchers.IO) { api.chats(token) }); selectedChat = chats.firstOrNull { it.id == id }; messages.clear() }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть чат" } }
            } }
            topicsGroup?.let { group -> NativeTopicsDialog(group,token,api,{topicsGroup=null},{
                scope.launch { try { val current=selectedChat?.id;val rows=withContext(Dispatchers.IO){api.chats(token)};chats.clear();chats.addAll(rows);selectedChat=rows.firstOrNull{it.id==current} } catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()} }
            }) { id -> topicsGroup=null;scope.launch {try {val rows=withContext(Dispatchers.IO){api.chats(token)};chats.clear();chats.addAll(rows);selectedChat=rows.firstOrNull{it.id==id};messages.clear()}catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}} } }
            manageCommunity?.let { chat -> CommunityManageDialog(chat, me, token, api, { manageCommunity = null }, {
                scope.launch { try { chats.clear(); chats.addAll(withContext(Dispatchers.IO) { api.chats(token) }); selectedChat = chats.firstOrNull { it.id == selectedChat?.id } }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось обновить чаты" } }
            }, { manageCommunity = null; selectedChat = null; messages.clear() }, onOpenAttachment = { attachmentPreview = it }) }
            galleryChat?.let { chat -> AttachmentGallery(chat, token, api, { attachmentPreview = it }, { galleryChat = null }) }
            attachmentPreview?.let { message -> AttachmentViewer(message, token, api, { attachmentPreview = null }) }
            attachmentBatch?.takeIf { it.voiceFile == null || attachmentError.isNotBlank() }?.let { batch -> NativeAttachmentComposer(batch, attachmentSending, attachmentStatus, attachmentError,
                onDismiss = { discardBatch(batch) }, onSend = { sendBatch(batch, it) }) }
            if (callDiagnosticsOpen) {
                val clipboard = LocalClipboardManager.current
                AlertDialog(onDismissRequest = { callDiagnosticsOpen = false }, title = { NativeText("Диагностика звонка") }, text = {
                    androidx.compose.foundation.text.selection.SelectionContainer {
                        NativeText(callDiagnosticReport, fontSize = 11.sp, modifier = Modifier.height(350.dp).verticalScroll(rememberScrollState()))
                    }
                }, confirmButton = { TextButton(onClick = { clipboard.setText(AnnotatedString(callDiagnosticReport)); Toast.makeText(context, "Диагностика скопирована", Toast.LENGTH_SHORT).show() }) { NativeText("Копировать") } },
                    dismissButton = { TextButton(onClick = { callDiagnosticsOpen = false }) { NativeText("Закрыть") } })
            }
            updateAvailable?.takeIf { it.versionCode != dismissedUpdate && callState.call == null && !attachmentSending && !updateBusy }?.let { release ->
                AlertDialog(onDismissRequest = { dismissedUpdate = release.versionCode }, title = { NativeText("Вышла новая версия") }, text = { NativeText("Доступна Волна ${release.versionName}. Давайте обновимся? Приложение скачает обновление и откроет установку Android.") },
                    confirmButton = { TextButton(onClick = { dismissedUpdate = release.versionCode; installUpdate(release) }) { NativeText("Обновить") } },
                    dismissButton = { TextButton(onClick = { dismissedUpdate = release.versionCode }) { NativeText("Позже") } })
            }
            val forwarding = forwardTargetMessage
            if (forwarding != null) {
                AlertDialog(
                    onDismissRequest = { if (!busy) forwardTargetMessage = null },
                    title = { NativeText(if (forwardBatch.size > 1) "Переслать ${forwardBatch.size} сообщений" else "Переслать сообщение") },
                    text = {
                        if (chats.isEmpty()) NativeText("Нет переписок для пересылки", color = Muted)
                        else LazyColumn(Modifier.height(280.dp)) {
                            items(chats, key = { "forward-${it.id}" }) { target ->
                                TextButton(enabled = !busy, onClick = {
                                    scope.launch {
                                        busy = true
                                        try {
                                            val batch = forwardBatch.ifEmpty { listOf(forwarding) }
                                            for (message in batch) {
                                                val clientId = UUID.nameUUIDFromBytes((forwardNonce + ":" + target.id + ":" + message.id).toByteArray()).toString()
                                                val sent = withContext(Dispatchers.IO) { api.forward(token, message.id, target.id, clientId) }
                                                if (selectedChat?.id == target.id && messages.none { it.id == sent.id }) messages.add(sent)
                                            }
                                            chats.clear(); chats.addAll(withContext(Dispatchers.IO) { api.chats(token) })
                                            forwardTargetMessage = null
                                        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось переслать сообщение" }
                                        finally { busy = false }
                                    }
                                }) { NativeText(target.name, color = TextMain, maxLines = 1) }
                            }
                        }
                    },
                    confirmButton = { TextButton(onClick = { forwardTargetMessage = null }) { NativeText("Закрыть", color = Muted) } },
                    containerColor = Panel, titleContentColor = TextMain, textContentColor = TextMain
                )
            }
            if (extraAttachment.isNotBlank()) NativeShareSheet(extraAttachment, token, api, { extraAttachment = "" }) { text ->
                val chatId = pickedChat
                extraAttachment = ""
                if (chatId != null) scope.launch {
                    busy = true
                    try { val created = withContext(Dispatchers.IO) { api.send(token, chatId, text, pickedReply) }; if (selectedChat?.id == chatId) { messages.add(created); pickedOnSent?.invoke() } }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось отправить" }
                    finally { busy = false }
                }
            }
            if (callState.call != null && !callState.minimized && !NativeCallLayout.inPip) NativeCallScreen(callState, token)
        }
    }
}

@Composable
internal fun UpdateBanner(update: VolnaUpdate, busy: Boolean, status: String, onUpdate: () -> Unit, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(14.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 13.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                NativeText("Доступно обновление ${update.versionName}", color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                NativeText(status.ifBlank { "Нажмите «Обновить», чтобы установить его" }, color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
            }
            Button(onClick = onUpdate, enabled = !busy, shape = RoundedCornerShape(10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 7.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), color = AccentText, strokeWidth = 2.dp)
                else NativeText("Обновить", fontSize = 12.sp)
            }
        }
    }
}

@Composable
internal fun PersonRow(person: VolnaUser, token: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(person.name, person.id, person.avatarUrl, token)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            NativeText(person.name, color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            NativeText("@${person.username}", color = Muted, fontSize = 12.sp)
        }
        Icon(Icons.Outlined.ArrowForward, null, tint = Accent, modifier = Modifier.size(18.dp))
    }
}

@Composable
internal fun Avatar(name: String, seed: Long, url: String? = null, token: String = "", size: androidx.compose.ui.unit.Dp = 48.dp) {
    val colors = listOf(Color(0xFF5379B8), Color(0xFFD58254), Color(0xFF8870C7), Color(0xFF35927E), Color(0xFFC47199))
    Box(Modifier.size(size).clip(CircleShape).background(colors[(kotlin.math.abs(seed) % colors.size).toInt()]), contentAlignment = Alignment.Center) {
        NativeText(name.trim().firstOrNull()?.uppercase() ?: "В", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        if (!url.isNullOrBlank()) AsyncImage(imageRequest(androidx.compose.ui.platform.LocalContext.current, url, token), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
internal fun SectionTitle(title: String, count: Int? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        NativeText(title, color = Muted, fontSize = 10.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (count != null) NativeText(count.toString(), color = Muted, fontSize = 10.sp)
    }
}

@Composable
private fun EmptyChats() {
    Column(Modifier.fillMaxWidth().padding(top = 76.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Muted, modifier = Modifier.size(37.dp))
        NativeText("Здесь будут ваши чаты", color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp))
        NativeText("Найдите человека по имени, телефону или @username", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun EmptyNote(text: String) {
    NativeText(text, color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(24.dp))
}

@Composable
internal fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    NativeText(message, color = Color(0xFFFFB3B3), fontSize = 12.sp, lineHeight = 17.sp,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF442830)).padding(12.dp))
}

internal fun readAttachment(resolver: android.content.ContentResolver, uri: Uri): ByteArray {
    val input = resolver.openInputStream(uri) ?: throw IllegalStateException("Не удалось прочитать файл")
    input.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            total += read
            if (total > 20 * 1024 * 1024) throw IllegalStateException("Максимальный размер файла — 20 МБ")
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }
}

private fun clock(value: String): String = try {
    DateTimeFormatter.ofPattern("HH:mm", Locale("ru")).withZone(ZoneId.systemDefault()).format(Instant.parse(value))
} catch (_: Exception) { "" }
