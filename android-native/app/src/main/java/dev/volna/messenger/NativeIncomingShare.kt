package dev.volna.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.coroutines.coroutineContext

internal data class NativeIncomingShare(val id: String, val text: String, val uris: List<Uri>, val error: String = "") {
    companion object {
        @Suppress("DEPRECATION")
        fun parse(intent: Intent?, id: String = UUID.randomUUID().toString()): NativeIncomingShare? {
            if (intent?.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return null
            return try {
                val source = intent!!
                val text = source.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
                val subject = source.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
                val content = if (subject.isNotBlank() && !text.startsWith(subject)) listOf(subject, text).filter { it.isNotBlank() }.joinToString("\n") else text
                val streams = if (source.action == Intent.ACTION_SEND_MULTIPLE) source.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                    else listOfNotNull(source.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
                val clips = source.clipData?.let { clip -> (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri } }.orEmpty()
                val uris = (streams + clips).distinct()
                val error = when {
                    uris.size > 10 -> "Можно отправить не больше 10 вложений за раз"
                    uris.any { it.scheme != "content" } -> "Приложение-источник не предоставило доступ к вложению"
                    content.isBlank() && uris.isEmpty() -> "Приложение-источник не передало текст или вложения"
                    else -> ""
                }
                NativeIncomingShare(id, content, uris, error)
            } catch (_: Exception) { NativeIncomingShare(id, "", emptyList(), "Не удалось прочитать данные из другого приложения") }
        }
    }
}

internal data class NativePreparedShare(val files: List<NativeSelectedAttachment>, val directory: File?)

internal suspend fun prepareIncomingShare(context: Context, share: NativeIncomingShare): NativePreparedShare = withContext(Dispatchers.IO) {
    require(share.error.isBlank()) { share.error }
    if (share.uris.isEmpty()) return@withContext NativePreparedShare(emptyList(), null)
    val parent = File(context.cacheDir, "incoming-shares").apply { mkdirs() }
    val directory = java.nio.file.Files.createTempDirectory(parent.toPath(), "share-").toFile()
    try {
        val files = selectedAttachments(context.contentResolver, share.uris).mapIndexed { index, attachment ->
            coroutineContext.ensureActive()
            val name = attachment.name.replace(Regex("[\\\\/\\x00-\\x1f]"), "_").trim().trim('.').take(120).ifBlank { "Вложение" }
            val destination = File(directory, "$index-$name")
            context.contentResolver.openInputStream(attachment.uri)?.use { input ->
                destination.outputStream().use { output ->
                    val buffer = ByteArray(8192); var total = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= 20L * 1024 * 1024) { "$name: максимальный размер — 20 МБ" }
                        output.write(buffer, 0, count)
                    }
                }
            } ?: error("Не удалось открыть $name. Повторите «Поделиться» из исходного приложения.")
            attachment.copy(uri = Uri.fromFile(destination), name = name)
        }
        NativePreparedShare(files, directory)
    } catch (problem: Exception) { directory.deleteRecursively(); throw problem }
}

@Composable
internal fun NativeIncomingShareDialog(share: NativeIncomingShare, chats: List<VolnaChat>, token: String, accountName: String,
    api: NativeApi, transferBusy: Boolean, onDismiss: () -> Unit,
    onFiles: (VolnaChat, String, NativePreparedShare) -> Unit, onTextSent: (VolnaChat, VolnaMessage) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable(share.id) { mutableStateOf(share.text) }
    var query by rememberSaveable(share.id) { mutableStateOf("") }
    var targetId by rememberSaveable(share.id) { mutableStateOf(0L) }
    var prepared by remember(share.id) { mutableStateOf<NativePreparedShare?>(if (share.uris.isEmpty() && share.error.isBlank()) NativePreparedShare(emptyList(), null) else null) }
    var failure by remember(share.id) { mutableStateOf(share.error) }
    var preparing by remember(share.id) { mutableStateOf(share.error.isBlank() && share.uris.isNotEmpty()) }
    var sending by remember { mutableStateOf(false) }
    var submittedText by remember(share.id) { mutableStateOf<String?>(null) }
    var handedOff by remember(share.id) { mutableStateOf(false) }
    LaunchedEffect(share.id) {
        if (share.error.isBlank() && share.uris.isNotEmpty()) try { prepared = prepareIncomingShare(context, share) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { failure = problem.message ?: "Не удалось подготовить вложения" }
        finally { preparing = false }
    }
    DisposableEffect(share.id) { onDispose { if (!handedOff) prepared?.directory?.deleteRecursively() } }
    val target = chats.firstOrNull { it.id == targetId && it.canSend }
    val writable = chats.filter { it.canSend && (query.isBlank() || it.name.contains(query, ignoreCase = true)) }
    NativeFullScreen("Отправить в VLN", { if (!sending) onDismiss() }) {
        Column(Modifier.fillMaxSize().imePadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
                NativeText("Аккаунт: $accountName", color = Muted, fontSize = 12.sp)
                NativeOutlinedTextField(text, { text = it }, label = { NativeText(if (share.uris.isEmpty()) "Текст или ссылка" else "Подпись") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp), maxLines = 4, enabled = !sending && submittedText == null,
                    isError = text.length > 4000)
                if (text.length > 4000) NativeText("Сократите текст до 4000 символов", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                if (share.uris.isNotEmpty()) NativeText("Вложений: ${share.uris.size}", color = Muted, fontSize = 12.sp)
                if (preparing) LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 8.dp))
                if (failure.isNotBlank()) NativeText(failure, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                if (transferBusy) NativeText("Сначала завершите отправку или закройте прежнее вложение", color = Muted, fontSize = 12.sp)
                NativeOutlinedTextField(query, { query = it }, label = { NativeText("Выберите получателя") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    items(writable, key = { it.id }) { chat ->
                        Row(Modifier.fillMaxWidth().clickable(enabled = !sending && submittedText == null) { targetId = chat.id }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = targetId == chat.id, onClick = { targetId = chat.id }, enabled = !sending && submittedText == null)
                            NativeText(if (chat.parentName.isNotBlank()) "${chat.parentName} · ${chat.name}" else chat.name, color = TextMain, maxLines = 2)
                        }
                    }
                    if (writable.isEmpty()) item { NativeText("Нет доступных переписок. Создайте чат и повторите «Поделиться».", color = Muted, fontSize = 13.sp) }
                }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(enabled = !sending, onClick = onDismiss) { NativeText("Отмена") }
            TextButton(enabled = target != null && prepared != null && !preparing && !sending && !transferBusy && text.length <= 4000 && share.error.isBlank() && (text.isNotBlank() || prepared?.files?.isNotEmpty() == true), onClick = {
                val destination = target ?: return@TextButton
                val data = prepared ?: return@TextButton
                if (data.files.isNotEmpty()) { handedOff = true; onFiles(destination, text, data) }
                else {
                    submittedText = submittedText ?: text
                    sending = true
                    scope.launch {
                        try {
                            val nonce = UUID.nameUUIDFromBytes((share.id + ":" + destination.id).toByteArray()).toString()
                            val sent = withContext(Dispatchers.IO) { api.send(token, destination.id, submittedText.orEmpty(), null, null, nonce) }
                            onTextSent(destination, sent)
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (problem: Exception) { failure = problem.message ?: "Не удалось отправить" }
                        finally { sending = false }
                    }
                }
            }) { NativeText(if (sending) "Отправляем…" else if (submittedText != null && failure.isNotBlank()) "Повторить" else if (prepared?.files?.isNotEmpty() == true) "Далее" else "Отправить") }
            }
        }
    }
}
