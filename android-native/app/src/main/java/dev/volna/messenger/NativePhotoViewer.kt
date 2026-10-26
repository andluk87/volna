package dev.volna.messenger

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

internal data class PhotoStroke(val color: Int, val width: Float, val points: List<Offset>)
internal fun photoBitmap(file: File, edge: Int = 2048): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Не удалось прочитать фото" }
    var sample = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / sample > edge * 2) sample *= 2
    val source = if (Build.VERSION.SDK_INT >= 28) android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(file)) { decoder, info, _ ->
        decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
        val scale = minOf(1f, edge.toFloat() / maxOf(info.size.width, info.size.height))
        decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
    } else BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Не удалось прочитать фото")
    if (Build.VERSION.SDK_INT < 28) {
        val exif = androidx.exifinterface.media.ExifInterface(file)
        val matrix = android.graphics.Matrix().apply { if (exif.isFlipped) postScale(-1f, 1f); postRotate(exif.rotationDegrees.toFloat()) }
        if (!matrix.isIdentity) { val rotated = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true); if (rotated !== source) source.recycle(); return rotated }
    }
    return source
}
internal fun renderPhoto(source: Bitmap, strokes: List<PhotoStroke>): Bitmap {
    val result = source.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = android.graphics.Canvas(result)
    for (stroke in strokes) {
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = stroke.color; strokeWidth = stroke.width * result.width; strokeCap = android.graphics.Paint.Cap.ROUND; strokeJoin = android.graphics.Paint.Join.ROUND; style = android.graphics.Paint.Style.STROKE }
        val path = android.graphics.Path(); stroke.points.forEachIndexed { index, p -> if (index == 0) path.moveTo(p.x * result.width, p.y * result.height) else path.lineTo(p.x * result.width, p.y * result.height) }
        if (stroke.points.size == 1) canvas.drawPoint(stroke.points[0].x * result.width, stroke.points[0].y * result.height, paint) else canvas.drawPath(path, paint)
    }
    return result
}
private fun writePhoto(context: android.content.Context, bitmap: Bitmap): File = File(context.cacheDir, "attachments/photo-edits/${UUID.randomUUID()}.png").apply { parentFile?.mkdirs(); outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
internal fun savePhotoToGallery(context: android.content.Context, source: File, mime: String): android.net.Uri {
    val values = ContentValues().apply { put(MediaStore.Images.Media.DISPLAY_NAME, "VLN-${System.currentTimeMillis()}." + (if (mime == "image/png") "png" else source.extension.ifBlank { "jpg" })); put(MediaStore.Images.Media.MIME_TYPE, mime)
        if (Build.VERSION.SDK_INT >= 29) { put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/VLN"); put(MediaStore.Images.Media.IS_PENDING, 1) }
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("Не удалось создать фото в галерее")
    try { resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } } ?: error("Не удалось сохранить фото")
        if (Build.VERSION.SDK_INT >= 29) resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    } catch (problem: Exception) { resolver.delete(uri, null, null); throw problem }
    return uri
}

@Composable
internal fun NativePhotoViewer(initial: VolnaMessage, gallery: List<VolnaMessage>, token: String, api: NativeApi, onEditedReady: (File) -> Unit, canDelete: (VolnaMessage) -> Boolean, onAction: (VolnaMessage, String) -> Unit, onDismiss: () -> Unit, canReply: (VolnaMessage) -> Boolean = { true }) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var photos by remember(initial.id) { mutableStateOf((gallery + initial).filter { !it.deleted && it.chatId == initial.chatId && it.attachmentMime?.startsWith("image/") == true }.distinctBy { it.id }.sortedBy { it.id }) }
    var olderCursor by remember(initial.id) { mutableStateOf<Long?>(null) }; var morePhotos by remember(initial.id) { mutableStateOf(false) }
    var selected by remember(initial.id) { mutableStateOf(initial.id) }
    val index = photos.indexOfFirst { it.id == selected }.coerceAtLeast(0); val message = photos[index]
    var source by remember(message.id) { mutableStateOf<File?>(null) }; val edits = remember { mutableStateMapOf<Long, File>() }
    val file = edits[message.id] ?: source
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }; var status by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }; var drawing by remember { mutableStateOf(false) }; var deleting by remember { mutableStateOf(false) }; var sticker by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("Стикер из фото") }; var draftKey by remember { mutableStateOf("") }; var uploaded by remember { mutableStateOf<String?>(null) }; var nonce by remember { mutableStateOf(UUID.randomUUID().toString()) }
    fun run(block: suspend () -> Unit) { scope.launch { busy = true; error = ""; menu = false; try { block() } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Действие не выполнено" } finally { busy = false } } }
    fun save() { val current = file ?: return; run { withContext(Dispatchers.IO) { savePhotoToGallery(context, current, if (edits.containsKey(message.id)) "image/png" else message.attachmentMime ?: "image/jpeg") }; status = "Фото сохранено в галерею" } }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) save() else error = "Для сохранения разрешите доступ к галерее" }
    LaunchedEffect(initial.chatId, token) { try { val page = withContext(Dispatchers.IO) { api.gallery(token, initial.chatId, type = "media") }; photos = (photos + page.filter { it.attachmentMime?.startsWith("image/") == true }).distinctBy { it.id }.sortedBy { it.id }; olderCursor = page.lastOrNull()?.id; morePhotos = page.size == 50 } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (_: Exception) { /* Already loaded chat photos remain available. */ } }
    LaunchedEffect(message.id, token) { source = null; error = ""; status = ""; try { source = withContext(Dispatchers.IO) { val id = message.attachmentId ?: error("Нет фото"); val safeName = message.attachmentName.orEmpty().replace(Regex("[\\\\/\\x00-\\x1f]"), "_").take(160).trim().trim('.').ifBlank { "Фото" }; File(context.cacheDir, "attachments/$id/$safeName").apply { if (!isFile || length() == 0L || message.attachmentSize > 0 && length() != message.attachmentSize) api.downloadAttachment(token, id, this)
                    setLastModified(System.currentTimeMillis())
                    val cached = File(context.cacheDir, "attachments").walkTopDown().filter { it.isFile && it.parentFile?.name?.matches(Regex("[a-f0-9]{48}")) == true }.toList()
                    var bytes = cached.sumOf { it.length() }; cached.sortedBy { it.lastModified() }.forEach { old -> if (bytes > 100L*1024*1024 && old != this) { val length = old.length(); if (old.delete()) bytes -= length } } } } } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить фото" } }
    NativeFullScreen("Фото ${index + 1} / ${photos.size}", onDismiss) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(enabled = file != null && !busy, onClick = { drawing = true }) { NativeText("Рисовать") }
            Box { TextButton(enabled = !busy, onClick = { menu = true }) { NativeText("Меню ⋮") }; DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { NativeText("Сохранить в галерею") }, enabled = file != null, onClick = { menu = false; if (Build.VERSION.SDK_INT < 29 && context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) permission.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) else save() })
                DropdownMenuItem(text = { NativeText("Показать в чате") }, onClick = { onAction(message, "show"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Создать стикер") }, enabled = file != null, onClick = { menu = false; sticker = true })
                DropdownMenuItem(text = { NativeText("Ответить") }, enabled = canReply(message), onClick = { onAction(message, "reply"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Переслать оригинал") }, onClick = { onAction(message, "forward"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Поделиться") }, enabled = file != null, onClick = { menu = false; file?.let { current -> run { val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", current); context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(if (edits.containsKey(message.id)) "image/png" else message.attachmentMime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Поделиться фото")) } } })
                if (edits.containsKey(message.id)) DropdownMenuItem(text = { NativeText("Отправить рисунок") }, enabled = !busy, onClick = { file?.let(onEditedReady) })
                if (edits.containsKey(message.id)) DropdownMenuItem(text = { NativeText("Вернуть оригинал") }, onClick = { edits.remove(message.id); menu = false })
                if (canDelete(message)) DropdownMenuItem(text = { NativeText("Удалить") }, onClick = { menu = false; deleting = true })
            } }
        }
        var drag by remember(message.id) { mutableStateOf(0f) }
        var zoom by remember(message.id) { mutableStateOf(1f) }; var offset by remember(message.id) { mutableStateOf(Offset.Zero) }
        Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().pointerInput(message.id, photos.size) { detectTransformGestures { _, pan, factor, _ ->
            zoom = (zoom * factor).coerceIn(1f, 5f)
            if (zoom > 1f) { drag = 0f; offset = Offset((offset.x + pan.x).coerceIn(-size.width*(zoom-1)/2, size.width*(zoom-1)/2), (offset.y+pan.y).coerceIn(-size.height*(zoom-1)/2, size.height*(zoom-1)/2)) }
            else { offset = Offset.Zero; drag += pan.x; if (!busy && kotlin.math.abs(drag) > size.width * .25f) { photos.getOrNull(index + if (drag < 0) 1 else -1)?.let { selected = it.id }; drag = 0f } }
        } }, contentAlignment = Alignment.Center) {
            if (file != null) AsyncImage(file, message.attachmentName, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = offset.x; translationY = offset.y }) else CircularProgressIndicator()
        }
        if (edits.containsKey(message.id)) NativeText("Изменённая копия — сохраните или поделитесь ею", Modifier.padding(8.dp))
        if (error.isNotBlank()) ErrorBanner(error, Modifier.padding(8.dp))
        if (status.isNotBlank()) NativeText(status, Modifier.padding(8.dp))
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { TextButton(enabled = (index > 0 || morePhotos) && !busy, onClick = { if (index > 0) selected = photos[index - 1].id else run { val before = message.id; val page = withContext(Dispatchers.IO) { api.gallery(token, initial.chatId, olderCursor, "media") }; photos = (photos + page.filter { it.attachmentMime?.startsWith("image/") == true }).distinctBy { it.id }.sortedBy { it.id }; olderCursor = page.lastOrNull()?.id; morePhotos = page.size == 50; photos.lastOrNull { it.id < before }?.let { selected = it.id } } }) { NativeText("← Назад") }; TextButton(enabled = index < photos.lastIndex && !busy, onClick = { selected = photos[index + 1].id }) { NativeText("Далее →") } }
    }
    if (drawing && file != null) NativePhotoDrawing(file, { drawing = false }) { edits[message.id] = it; drawing = false }
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { NativeText("Удалить фото?") }, text = { NativeText("Сообщение будет удалено из чата.") }, confirmButton = { TextButton(onClick = { deleting = false; onAction(message, "delete"); onDismiss() }) { NativeText("Удалить") } }, dismissButton = { TextButton(onClick = { deleting = false }) { NativeText("Отмена") } })
    if (sticker) NativeFullScreen("Создать стикер", { if (!busy) sticker = false }) {
        OutlinedTextField(title, { title = it.take(64) }, label = { NativeText("Название личного набора") }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(12.dp))
        NativeText("Будет создан ваш личный набор со стикером из этого фото.", Modifier.padding(12.dp))
        if (error.isNotBlank()) ErrorBanner(error)
        Button(enabled = !busy && title.isNotBlank(), onClick = { val current = file ?: return@Button; run { val key = "${message.id}:${current.path}:${title.trim()}"; if (key != draftKey) { draftKey = key; uploaded = null; nonce = UUID.randomUUID().toString() }; withContext(Dispatchers.IO) { if (uploaded == null) { val image = photoBitmap(current, 512); val square = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888); val scale = 512f / maxOf(image.width, image.height); val w = image.width * scale; val h = image.height * scale; android.graphics.Canvas(square).drawBitmap(image, null, android.graphics.RectF((512 - w)/2, (512 - h)/2, (512 + w)/2, (512 + h)/2), android.graphics.Paint(3)); val bytes = java.io.ByteArrayOutputStream().apply { square.compress(Bitmap.CompressFormat.PNG, 100, this) }.toByteArray(); uploaded = api.upload(token, "sticker.png", "image/png", bytes); image.recycle(); square.recycle() }; api.createExpressionPack(token, title.trim(), "sticker", false, listOf(JSONObject().put("attachment_id", uploaded).put("label", title.trim()).put("keywords", org.json.JSONArray()).put("fallback", "✨")), nonce) }; sticker = false; status = "Стикер добавлен в личный набор" } }) { NativeText(if (busy) "Создание…" else "Создать стикер") }
    }
}

@Composable
private fun NativePhotoDrawing(file: File, onDismiss: () -> Unit, onApply: (File) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); var bitmap by remember(file) { mutableStateOf<Bitmap?>(null) }
    var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }; var discard by remember { mutableStateOf(false) }
    val strokes = remember { mutableStateListOf<PhotoStroke>() }; val redo = remember { mutableStateListOf<PhotoStroke>() }; var color by remember { mutableStateOf(Color.Red) }; var width by remember { mutableStateOf(.008f) }
    var current by remember { mutableStateOf<PhotoStroke?>(null) }
    LaunchedEffect(file) { try { bitmap = withContext(Dispatchers.IO) { photoBitmap(file) } } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть фото" } }
    DisposableEffect(file) { onDispose { bitmap?.recycle() } }
    fun close() { if (strokes.isEmpty()) onDismiss() else discard = true }
    NativeFullScreen("Рисовать на копии", ::close) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) { listOf(Color.Red, Color.Yellow, Color.Green, Color.Blue, Color.White, Color.Black).forEach { c -> TextButton(onClick = { color = c }) { Box(Modifier.size(if (color == c) 28.dp else 20.dp).background(c)) } } }
        Slider(width, { width = it }, valueRange = .003f.. .03f, modifier = Modifier.padding(horizontal = 16.dp))
        val image = bitmap
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { if (image != null) Box(Modifier.aspectRatio(image.width.toFloat()/image.height).fillMaxSize()) {
            AsyncImage(file, "Фото для рисования", contentScale = ContentScale.FillBounds, modifier = Modifier.fillMaxSize())
            Canvas(Modifier.fillMaxSize().pointerInput(color, width) { detectDragGestures(onDragStart = { p -> current = PhotoStroke(color.toArgb(), width, listOf(Offset((p.x/size.width).coerceIn(0f,1f),(p.y/size.height).coerceIn(0f,1f)))) }, onDrag = { change, _ -> change.consume(); current = current?.let { it.copy(points = it.points + Offset((change.position.x/size.width).coerceIn(0f,1f),(change.position.y/size.height).coerceIn(0f,1f))) } }, onDragEnd = { current?.let { strokes.add(it); redo.clear() }; current = null }, onDragCancel = { current = null }) }) { (strokes + listOfNotNull(current)).forEach { stroke -> stroke.points.zipWithNext().forEach { (a,b) -> drawLine(Color(stroke.color), Offset(a.x*size.width,a.y*size.height), Offset(b.x*size.width,b.y*size.height), stroke.width*size.width, StrokeCap.Round) } } }
        } else CircularProgressIndicator() }
        if (error.isNotBlank()) ErrorBanner(error)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(enabled = strokes.isNotEmpty() && !busy, onClick = { redo.add(strokes.removeAt(strokes.lastIndex)) }) { NativeText("Отменить") }
            TextButton(enabled = redo.isNotEmpty() && !busy, onClick = { strokes.add(redo.removeAt(redo.lastIndex)) }) { NativeText("Вернуть") }
            Button(enabled = image != null && !busy && strokes.isNotEmpty(), onClick = { busy = true; scope.launch { try { val saved = withContext(Dispatchers.IO) { val copy = renderPhoto(image!!, strokes.toList()); try { writePhoto(context, copy) } finally { copy.recycle() } }; onApply(saved) } catch (problem: Exception) { error = problem.message ?: "Не удалось сохранить рисунок" } finally { busy = false } } }) { NativeText("Применить") }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { NativeText("Отменить рисунок?") }, confirmButton = { TextButton(onClick = onDismiss) { NativeText("Отменить рисунок") } }, dismissButton = { TextButton(onClick = { discard = false }) { NativeText("Продолжить") } })
}
