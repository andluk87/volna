@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package dev.volna.messenger

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import android.widget.MediaController
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

internal fun imageRequest(context: android.content.Context, path: String, token: String = ""): ImageRequest {
    val local = path.matches(Regex("/api/files/[a-f0-9]{48}"))
    return ImageRequest.Builder(context).data(if (local) BuildConfig.API_BASE_URL.trimEnd('/') + path else path)
        .apply {
            if (local && token.isNotBlank()) {
                addHeader("Authorization", "Bearer $token")
                val session = java.security.MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
                memoryCacheKey("$session:$path"); diskCacheKey("$session:$path")
            }
        }.build()
}

@Composable
fun AttachmentThumbnail(message: VolnaMessage, token: String, onOpen: () -> Unit, modifier: Modifier = Modifier, onLongPress: (() -> Unit)? = null) {
    val context = LocalContext.current
    Box(modifier.clip(RoundedCornerShape(10.dp)).background(Input).combinedClickable(onClick = onOpen, onLongClick = onLongPress), contentAlignment = Alignment.Center) {
        if (message.attachmentMime?.startsWith("image/") == true && message.attachmentId != null) AsyncImage(
            model = imageRequest(context, "/api/files/${message.attachmentId}", token), contentDescription = message.attachmentName,
            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else if (message.attachmentMime?.startsWith("video/") == true && message.attachmentId != null) {
            AsyncImage(imageRequest(context, "/api/files/${message.attachmentId}", token), message.attachmentName, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Icon(Icons.Outlined.PlayCircleOutline, "Воспроизвести видео", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(36.dp))
        } else Icon(Icons.Outlined.Description, message.attachmentName, tint = Accent, modifier = Modifier.size(36.dp))
    }
}

@Composable
fun AttachmentViewer(message: VolnaMessage, token: String, api: NativeApi, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var file by remember(message.id) { mutableStateOf<File?>(null) }
    var busy by remember(message.id) { mutableStateOf(true) }
    var status by remember(message.id) { mutableStateOf("") }
    var error by remember(message.id) { mutableStateOf("") }
    var videoView by remember { mutableStateOf<VideoView?>(null) }
    var zoom by remember(message.id) { mutableStateOf(1f) }
    var offset by remember(message.id) { mutableStateOf(Offset.Zero) }
    val mime = message.attachmentMime?.takeUnless { it == "application/octet-stream" } ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(message.attachmentName.orEmpty().substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    val safeName = message.attachmentName.orEmpty().replace(Regex("[\\\\/\\x00-\\x1f]"), "_").take(160).trim().trim('.').ifBlank { "Вложение" }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val destination = result.data?.data
        val source = file
        if (result.resultCode == Activity.RESULT_OK && destination != null && source != null) scope.launch {
            busy = true; error = ""
            try {
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(destination, "wt")?.use { output -> source.inputStream().use { it.copyTo(output) } } ?: throw IllegalStateException("Не удалось открыть место сохранения") }
                status = "Вложение сохранено"
            } catch (problem: Exception) { error = problem.message ?: "Не удалось сохранить вложение" }
            finally { busy = false }
        }
    }
    fun shareUri(source: File): Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", source)
    LaunchedEffect(message.id, token) {
        try {
            val id = message.attachmentId ?: throw IllegalStateException("Нет вложения")
            val destination = File(context.cacheDir, "attachments/$id/$safeName")
            withContext(Dispatchers.IO) {
                if (!destination.isFile || destination.length() == 0L || message.attachmentSize > 0 && destination.length() != message.attachmentSize) api.downloadAttachment(token, id, destination)
                destination.setLastModified(System.currentTimeMillis())
                val files = File(context.cacheDir, "attachments").walkTopDown().filter { it.isFile && it.parentFile?.name?.matches(Regex("[a-f0-9]{48}")) == true }.toList()
                var total = files.sumOf { it.length() }
                files.sortedBy { it.lastModified() }.forEach { old -> if (total > 100L * 1024 * 1024 && old != destination) { val bytes = old.length(); if (old.delete()) total -= bytes } }
            }
            file = destination
        } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить вложение" }
        finally { busy = false }
    }
    DisposableEffect(message.id) { onDispose { videoView?.stopPlayback() } }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        NativeDialogSystemBars()
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), color = Ink) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    NativeText(safeName, Modifier.weight(1f), maxLines = 2, fontSize = 14.sp, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Закрыть вложение") }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    val source = file
                    when {
                        busy -> CircularProgressIndicator()
                        source != null && mime.startsWith("image/") -> Box(Modifier.fillMaxSize().clipToBounds().pointerInput(message.id) {
                            detectTransformGestures { _, pan, factor, _ ->
                                zoom = (zoom * factor).coerceIn(1f, 5f)
                                offset = if (zoom == 1f) Offset.Zero else Offset((offset.x + pan.x).coerceIn(-size.width * (zoom - 1) / 2, size.width * (zoom - 1) / 2), (offset.y + pan.y).coerceIn(-size.height * (zoom - 1) / 2, size.height * (zoom - 1) / 2))
                            }
                        }) { AsyncImage(source, safeName, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = offset.x; translationY = offset.y }) }
                        source != null && mime.startsWith("video/") -> AndroidView(factory = { VideoView(it).apply {
                            videoView = this; setAudioFocusRequest(android.media.AudioManager.AUDIOFOCUS_NONE)
                            setMediaController(MediaController(it)); setVideoURI(shareUri(source)); setOnPreparedListener { player ->
                                if (NativeCalls.state.value.call != null) player.setVolume(0f, 0f)
                                start()
                            }
                            setOnErrorListener { _, _, _ -> error = "Формат видео не поддерживается. Откройте его в другом приложении."; true }
                        } }, modifier = Modifier.fillMaxSize())
                        else -> Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Outlined.Description, null, tint = Accent, modifier = Modifier.size(56.dp)); NativeText(safeName, Modifier.padding(16.dp)) }
                    }
                }
                if (error.isNotBlank()) ErrorBanner(error, Modifier.padding(12.dp))
                if (status.isNotBlank()) NativeText(status, Modifier.padding(12.dp), color = Accent, fontSize = 12.sp)
                Row(Modifier.fillMaxWidth().background(Panel).padding(8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    TextButton(enabled = file != null && !busy, onClick = { save.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, safeName)) }) { Icon(Icons.Outlined.Download, null); NativeText("Сохранить") }
                    TextButton(enabled = file != null && !busy, onClick = {
                        file?.let { source -> try { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, shareUri(source)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Поделиться вложением")) }
                            catch (problem: Exception) { error = problem.message ?: "Не удалось поделиться файлом" } }
                    }) { Icon(Icons.Outlined.Share, null); NativeText("Поделиться") }
                }
                TextButton(enabled = file != null && !busy, modifier = Modifier.align(Alignment.CenterHorizontally), onClick = {
                    file?.let { source -> try { context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(shareUri(source), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                        catch (_: Exception) { error = "Нет приложения для этого формата. Сохраните файл и откройте его позже." } }
                }) { NativeText("Открыть в приложении") }
            }
        }
    }
}

@Composable
fun AttachmentGallery(chat: VolnaChat, token: String, api: NativeApi, onOpen: (VolnaMessage) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val media = remember(chat.id) { mutableStateListOf<VolnaMessage>() }
    var busy by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(true) }
    var filter by remember { mutableStateOf("all") }
    var error by remember { mutableStateOf("") }
    fun load() {
        if (busy || !more) return
        busy = true
        scope.launch {
            try {
                val page = withContext(Dispatchers.IO) { api.gallery(token, chat.id, media.lastOrNull()?.id) }
                media.addAll(page.filter { row -> media.none { it.id == row.id } }); more = page.size == 50
            } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть галерею" }
            finally { busy = false }
        }
    }
    LaunchedEffect(chat.id) { load() }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), color = Ink) {
            Column {
                Row(Modifier.fillMaxWidth().background(Panel).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    NativeText("Вложения · ${chat.name}", Modifier.weight(1f), maxLines = 1, fontSize = 17.sp)
                    IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Закрыть галерею") }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    listOf("all" to "Все", "image" to "Фото", "video" to "Видео", "file" to "Файлы").forEach { (key, label) -> TextButton(onClick = { filter = key }) { NativeText(label, color = if (filter == key) Accent else Muted) } }
                }
                if (error.isNotBlank()) ErrorBanner(error, Modifier.padding(12.dp))
                val visible = media.filter { message -> when (filter) { "image" -> message.attachmentMime?.startsWith("image/") == true; "video" -> message.attachmentMime?.startsWith("video/") == true; "file" -> message.attachmentMime?.startsWith("image/") != true && message.attachmentMime?.startsWith("video/") != true; else -> true } }
                LazyVerticalGrid(GridCells.Adaptive(135.dp), modifier = Modifier.weight(1f).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(visible, key = { it.id }) { message -> Column(Modifier.clickable { onOpen(message) }) {
                        AttachmentThumbnail(message, token, { onOpen(message) }, Modifier.fillMaxWidth().height(120.dp))
                        NativeText(message.attachmentName ?: "Вложение", fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        NativeText("${(message.attachmentSize / 1024).coerceAtLeast(1)} КБ", color = Muted, fontSize = 10.sp)
                    } }
                }
                if (media.isEmpty() && !busy && error.isBlank()) NativeText("Вложений пока нет", Modifier.padding(16.dp), color = Muted)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (more) TextButton(onClick = { load() }, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally)) { NativeText(if (busy) "Загружаем…" else "Показать ещё") }
            }
        }
    }
}
