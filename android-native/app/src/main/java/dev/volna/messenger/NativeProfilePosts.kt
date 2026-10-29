@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import java.io.File
import java.util.UUID

internal fun nativePostBytes(input: java.io.InputStream, limit: Int = 20 * 1024 * 1024): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= limit) { "Максимальный размер — 20 МБ" }; output.write(buffer, 0, count) }
    return output.toByteArray()
}

internal fun nativePostTemporaryFile(context: android.content.Context, mime: String): File {
    val directory = File(context.cacheDir, "attachments/posts").apply { mkdirs() }
    val suffix = when (mime) { "video/webm" -> ".webm"; "video/mp4" -> ".mp4"; "image/png" -> ".png"; "image/webp" -> ".webp"; else -> ".jpg" }
    return File.createTempFile("volna-post-", suffix, directory)
}

@Composable
internal fun NativeProfilePosts(userId: Long, own: Boolean, archive: Boolean, token: String, api: NativeApi, modifier: Modifier = Modifier) {
    var rows by remember(userId, archive, token) { mutableStateOf(emptyList<VolnaProfilePost>()) }
    var loading by remember(userId, archive, token) { mutableStateOf(false) }; var error by remember(userId, archive, token) { mutableStateOf("") }
    var more by remember(userId, archive, token) { mutableStateOf(false) }; var revision by remember(userId, archive, token) { mutableStateOf(0) }
    var creating by remember(userId, archive, token) { mutableStateOf(false) }; var deleting by remember(userId, archive, token) { mutableStateOf<VolnaProfilePost?>(null) }
    var preview by remember(userId, archive, token) { mutableStateOf<VolnaProfilePost?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load(older: Boolean = false) {
        if (loading && older) return
        loading = true
        try { val page = withContext(Dispatchers.IO) { api.profilePosts(token, userId, archive, if (older) rows.lastOrNull()?.id else null) }; rows = if (older) (rows + page).distinctBy { it.id } else page; more = page.size == 30; error = "" }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Публикации недоступны" } finally { loading = false }
    }
    LaunchedEffect(userId, archive, token, revision) { load() }
    LaunchedEffect(userId, token) { MessagingService.signals.collect { if (it.type == "profile-posts" && it.userId == userId) revision++ } }
    Column(modifier.fillMaxWidth()) {
        if (own && !archive) TextButton(onClick = { creating = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Icon(Icons.Outlined.AddAPhoto, null); NativeText("Добавить публикацию", Modifier.padding(start = 8.dp)) }
        if (error.isNotBlank()) NativeConnectionNotice(error) { revision++ }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (rows.isEmpty() && !loading && error.isBlank()) item { NativeEmptyState(if (archive) Icons.Outlined.Archive else Icons.Outlined.PhotoLibrary, if (archive) "Архив публикаций пуст" else "Публикаций пока нет", if (own && !archive) "Поделитесь текстом, фото или видео в своём профиле" else "Здесь появятся публикации профиля") }
            items(rows, key = { it.id }) { post ->
                var menu by remember(post.id) { mutableStateOf(false) }
                Surface(color = Panel, shape = RoundedCornerShape(16.dp)) { Column(Modifier.fillMaxWidth()) {
                    if (post.fileId != null) {
                        if (post.mime.startsWith("image/")) AsyncImage(model = imageRequest(LocalContext.current, "/api/files/${post.fileId}", token), contentDescription = "Фото публикации", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(220.dp).clickable { preview = post })
                        else Row(Modifier.fillMaxWidth().clickable { preview = post }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.PlayCircle, "Смотреть видео", tint = Accent, modifier = Modifier.size(40.dp)); NativeText(post.fileName, Modifier.weight(1f).padding(start = 12.dp), maxLines = 2) }
                    }
                    if (post.text.isNotBlank()) NativeLinkedText(post.text, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), token = token)
                    Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        NativeText(nativeDay(java.time.Instant.ofEpochMilli(post.created).toString()) + " · " + nativeClock(java.time.Instant.ofEpochMilli(post.created).toString()), color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                        if (own) Box { IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "Действия публикации", tint = Muted) }; DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { NativeText(if (archive) "Вернуть из архива" else "В архив") }, onClick = { menu = false; scope.launch { try { withContext(Dispatchers.IO) { api.archivePost(token, post.id, !archive) }; revision++ } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } } })
                            DropdownMenuItem(text = { NativeText("Удалить", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; deleting = post })
                        } } else Spacer(Modifier.height(36.dp))
                    }
                } }
            }
            if (more) item { TextButton(onClick = { scope.launch { load(true) } }, enabled = !loading) { NativeText("Ещё публикации") } }
        }
    }
    if (creating) NativeCreatePost(token, api, { creating = false }) { creating = false; revision++ }
    deleting?.let { post -> AlertDialog(onDismissRequest = { deleting = null }, title = { NativeText("Удалить публикацию?") }, text = { NativeText("Публикация исчезнет из профиля и архива.") }, confirmButton = { TextButton(onClick = { scope.launch { try { withContext(Dispatchers.IO) { api.deletePost(token, post.id) }; deleting = null; revision++ } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty(); deleting = null } } }) { NativeText("Удалить", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { deleting = null }) { NativeText("Отмена") } }) }
    preview?.let { post -> key(post.id) { NativePostPreview(post, token, api, { preview = null }) { direction -> val media = rows.filter { it.fileId != null }; val index = media.indexOfFirst { it.id == post.id }; media.getOrNull(index + direction)?.let { preview = it } } } }
}

@Composable
private fun NativeCreatePost(token: String, api: NativeApi, onDismiss: () -> Unit, onPublished: () -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }; var uri by remember { mutableStateOf<android.net.Uri?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var uploaded by remember { mutableStateOf<String?>(null) }; val client = rememberSaveable { UUID.randomUUID().toString() }
    val choose = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { if (it != null) { uri = it; uploaded = null } }
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, containerColor = Panel) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeText("Новая публикация", fontSize = 20.sp)
            NativeText("Публикацию увидят авторизованные пользователи VLN. Архив виден только вам.", color = Muted, fontSize = 12.sp)
            NativeOutlinedTextField(text, { if (it.length <= 4000) text = it }, Modifier.fillMaxWidth().heightIn(max = 180.dp), label = { NativeText("Текст публикации") }, enabled = !busy)
            TextButton(enabled = !busy && uploaded == null, onClick = { choose.launch(arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm")) }) { Icon(Icons.Outlined.AttachFile, null); NativeText(if (uri == null) "Фото или видео до 20 МБ" else "Фото или видео выбрано", Modifier.padding(start = 8.dp)) }
            if (uri != null && uploaded == null) TextButton(enabled = !busy, onClick = { uri = null }) { NativeText("Убрать вложение") }
            if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
            TextButton(enabled = !busy, onClick = onDismiss) { NativeText("Отмена") }
            Button(enabled = !busy && (text.isNotBlank() || uri != null), onClick = { scope.launch {
                busy = true; error = ""
                try {
                    val file = uri
                    if (file != null && uploaded == null) uploaded = withContext(Dispatchers.IO) {
                        val mime = context.contentResolver.getType(file).orEmpty(); require(mime in listOf("image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm")) { "Выберите фото или видео" }
                        val bytes = context.contentResolver.openInputStream(file)?.use { nativePostBytes(it) } ?: throw IllegalStateException("Файл недоступен")
                        require(bytes.size <= 20 * 1024 * 1024) { "Максимальный размер — 20 МБ" }
                        api.upload(token, "publication." + mime.substringAfter('/'), mime, bytes)
                    }
                    withContext(Dispatchers.IO) { api.publishPost(token, text, uploaded, client) }; onPublished()
                } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось опубликовать" } finally { busy = false }
            } }) { if (busy) CircularProgressIndicator(Modifier.size(20.dp)) else NativeText("Опубликовать") }
        }
    }
}

@Composable
private fun NativePostPreview(post: VolnaProfilePost, token: String, api: NativeApi, onDismiss: () -> Unit, onStep: (Int) -> Unit) {
    val context = LocalContext.current
    val temporary = remember(post.id) { nativePostTemporaryFile(context, post.mime) }
    var file by remember(post.id) { mutableStateOf<File?>(null) }; var error by remember { mutableStateOf("") }; var panels by remember { mutableStateOf(true) }
    DisposableEffect(temporary) { onDispose { temporary.delete(); File(temporary.path + ".part").delete() } }
    LaunchedEffect(post.id) { try { withContext(Dispatchers.IO) { api.downloadAttachment(token, post.fileId!!, temporary) }; ensureActive(); file = temporary } catch (cancelled: CancellationException) { temporary.delete(); throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } }
    NativeMediaFrame("Публикация", panels, onDismiss) {
        if (error.isNotBlank()) NativeText(error, color = Color.White, modifier = Modifier.padding(16.dp))
        else if (file == null) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else NativeMediaSurface(VolnaMessage(-post.id, post.userId, "", post.text, java.time.Instant.ofEpochMilli(post.created).toString(), false, post.fileName, post.fileId, post.mime), file, token, onStep, onDismiss, { panels = !panels }, { error = it }, Modifier.weight(1f))
    }
}
