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
import kotlinx.coroutines.flow.collect
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
internal fun savePhotoToGallery(context: android.content.Context, source: File, mime: String) = saveMediaToGallery(context,source,mime)
internal fun saveMediaToGallery(context: android.content.Context, source: File, mime: String): android.net.Uri {
    val video = mime.startsWith("video/")
    val values = ContentValues().apply { put(MediaStore.Images.Media.DISPLAY_NAME, "VLN-${System.currentTimeMillis()}." + (if (mime == "image/png") "png" else source.extension.ifBlank { "jpg" })); put(MediaStore.Images.Media.MIME_TYPE, mime)
        if (Build.VERSION.SDK_INT >= 29) { put(MediaStore.Images.Media.RELATIVE_PATH, if(video) "Movies/VLN" else "Pictures/VLN"); put(MediaStore.Images.Media.IS_PENDING, 1) }
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(if(video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("Не удалось создать фото в галерее")
    try { resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } } ?: error("Не удалось сохранить фото")
        if (Build.VERSION.SDK_INT >= 29) resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    } catch (problem: Exception) { resolver.delete(uri, null, null); throw problem }
    return uri
}

@Composable
internal fun NativePhotoViewer(initial: VolnaMessage, gallery: List<VolnaMessage>, token: String, api: NativeApi, onEditedReady: (File) -> Unit, canDelete: (VolnaMessage) -> Boolean, onAction: (VolnaMessage, String) -> Unit, onDismiss: () -> Unit, canReply: (VolnaMessage) -> Boolean = { true }, onDelete: suspend (VolnaMessage) -> VolnaMessage = { withContext(Dispatchers.IO) { api.deleteMessage(token,it.id) } }) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    val window = remember(initial.id, token) { NativeMediaWindow(initial,gallery,token,api) }
    val photos = window.items; val selected = window.selected; val index = window.index; val message = window.current ?: initial
    val video = message.attachmentMime?.startsWith("video/") == true
    var panels by remember { mutableStateOf(true) }; var information by remember { mutableStateOf(false) }; var attempt by remember { mutableStateOf(0) }
    val account = NativeCredentials.accountId(token)
    fun step(delta: Int) { if(window.loading&&!window.ready)return;photos.getOrNull(index+delta)?.let { window.selected=it.id;panels=true } }
    var source by remember(message.id) { mutableStateOf<File?>(null) }; val edits = remember { mutableStateMapOf<Long, File>() }
    val file = edits[message.id] ?: source
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }; var status by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }; var drawing by remember { mutableStateOf(false) }; var deleting by remember { mutableStateOf(false) }; var sticker by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("Стикер из фото") }; var draftKey by remember { mutableStateOf("") }; var uploaded by remember { mutableStateOf<String?>(null) }; var nonce by remember { mutableStateOf(UUID.randomUUID().toString()) }
    fun run(block: suspend () -> Unit) { scope.launch { busy = true; error = ""; menu = false; try { block() } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Действие не выполнено" } finally { busy = false } } }
    fun save() { val current = file ?: return; run { withContext(Dispatchers.IO) { saveMediaToGallery(context, current, if (edits.containsKey(message.id)) "image/png" else message.attachmentMime ?: "image/jpeg") }; status = "Фото сохранено в галерею" } }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) save() else error = "Для сохранения разрешите доступ к галерее" }
    LaunchedEffect(initial.id, token) { window.load() }
    LaunchedEffect(index,window.before,window.after,window.ready) { if(index>=0&&window.ready){if(index<5)window.load("before");if(index>=window.items.size-5)window.load("after")} }
    LaunchedEffect(token) { MessagingService.events.collect { event -> if(event.account==account&&event.message.chatId==initial.chatId) { if(event.message.deleted){nativeMediaFile(context,token,event.message.copy(attachmentId=window.items.firstOrNull{it.id==event.message.id}?.attachmentId,attachmentName=window.items.firstOrNull{it.id==event.message.id}?.attachmentName)).delete()};window.update(event.message) } } }
    LaunchedEffect(token, initial.chatId) { MessagingService.signals.collect { event -> if(event.account==account&&event.chatId==initial.chatId&&event.type in listOf("removed","history-cleared"))window.deny() } }
    LaunchedEffect(window.denied) { if(window.denied)withContext(Dispatchers.IO){File(context.cacheDir,"attachments/media/$account").deleteRecursively()} }
    LaunchedEffect(message.id, token, attempt, window.current != null) {
        source = nativeMediaFile(context,token,message).takeIf { it.isFile && it.length()>0 };error="";status=""
        if(window.current!=null)try { source=cachedNativeMedia(context,token,message,api) }
        catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}
        catch(problem:Exception){error=problem.message?:"Не удалось загрузить медиа";if(problem is NativeApiException&&problem.status in listOf(401,403,404)){nativeMediaFile(context,token,message).delete();window.remove(message.id)}}
    }
    LaunchedEffect(message.id,window.items.size,token) { if(index>=0)kotlinx.coroutines.coroutineScope { photos.subList(maxOf(0,index-2),minOf(photos.size,index+3)).filter { it.id!=message.id&&it.attachmentMime?.startsWith("image/")==true&&it.attachmentSize<=8L*1024*1024 }.forEach { neighbor -> launch { try {cachedNativeMedia(context,token,neighbor,api)}catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){} } } } }
    val titleText=if(window.complete) "Медиа ${index+1} / ${photos.size}" else "Медиа"
    NativeMediaFrame(titleText,panels,{if(!busy)onDismiss()}) {
        if(window.current==null) { Text("Медиа удалено или недоступно",color=Color.White,modifier=Modifier.padding(16.dp));if(window.error.isNotBlank())Text(window.error,color=Color.White);TextButton(onClick={scope.launch{window.load()}}){Text("Повторить загрузку")};return@NativeMediaFrame }
        if(panels) Column(Modifier.fillMaxWidth().background(Color.Black).padding(horizontal=12.dp)) { Text(message.senderName,color=Color.White);Text(nativeMediaDate(message.createdAt),color=Color.White) }
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides Color.White) {
        Row(Modifier.fillMaxWidth().height(48.dp).graphicsLayer { alpha=if(panels)1f else 0f }, horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(enabled = panels && file != null && !busy && !video, onClick = { drawing = true }) { NativeText("Рисовать",color=Color.White) }
            Box { TextButton(enabled = !busy && panels, onClick = { menu = true }) { NativeText("Меню ⋮",color=Color.White) }; DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { NativeText("Информация") }, onClick = { menu=false;information=true })
                DropdownMenuItem(text = { NativeText("Сохранить в галерею") }, enabled = file != null, onClick = { menu = false; if (Build.VERSION.SDK_INT < 29 && context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) permission.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) else save() })
                DropdownMenuItem(text = { NativeText("Показать в чате") }, onClick = { onAction(message, "show"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Создать стикер") }, enabled = file != null && !video, onClick = { menu = false; sticker = true })
                DropdownMenuItem(text = { NativeText("Ответить") }, enabled = canReply(message), onClick = { onAction(message, "reply"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Переслать оригинал") }, onClick = { onAction(message, "forward"); onDismiss() })
                DropdownMenuItem(text = { NativeText("Поделиться") }, enabled = file != null, onClick = { menu = false; file?.let { current -> run { val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", current); context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(if (edits.containsKey(message.id)) "image/png" else message.attachmentMime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Поделиться фото")) } } })
                if (edits.containsKey(message.id)) DropdownMenuItem(text = { NativeText("Отправить рисунок") }, enabled = !busy, onClick = { file?.let(onEditedReady) })
                if (edits.containsKey(message.id)) DropdownMenuItem(text = { NativeText("Вернуть оригинал") }, onClick = { edits.remove(message.id); menu = false })
                if (canDelete(message)) DropdownMenuItem(text = { NativeText("Удалить") }, onClick = { menu = false; deleting = true })
            } }
        }
        NativeMediaSurface(message,file,token,::step,{if(!busy)onDismiss()},{panels=!panels},{error=it},Modifier.weight(1f).fillMaxWidth())
        if(panels && message.text.isNotBlank()) Text(message.text,color=Color.White,modifier=Modifier.fillMaxWidth().heightIn(max=140.dp).padding(12.dp))
        if(edits.containsKey(message.id)) NativeText("Изменённая копия — сохраните или поделитесь ею",Modifier.padding(8.dp),color=Color.White)
        if(error.isNotBlank()) {ErrorBanner(error,Modifier.padding(8.dp));TextButton(onClick={attempt++}){Text("Повторить загрузку")}}
        if(window.error.isNotBlank()){Text(window.error,color=Color.White);TextButton(onClick={scope.launch{window.load()}}){Text("Повторить загрузку списка")}}
        if(status.isNotBlank())Text(status,color=Color.White,modifier=Modifier.padding(8.dp))
        if(busy||window.loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth().height(48.dp).graphicsLayer{alpha=if(panels)1f else 0f},horizontalArrangement=Arrangement.SpaceBetween) {
            TextButton(enabled=panels&&index>0&&!busy,onClick={step(-1)}){Text("← Назад")}
            TextButton(enabled=panels&&index<photos.lastIndex&&!busy,onClick={step(1)}){Text("Далее →")}
        }
        }
    }
    if(information)NativeFullScreen("Информация о медиа",{information=false}){NativeText(message.attachmentName.orEmpty(),Modifier.padding(12.dp));NativeText(message.senderName);NativeText(nativeMediaDate(message.createdAt));NativeText("${message.attachmentMime} · ${message.attachmentSize/1024} КБ")}
    if (drawing && file != null) NativePhotoDrawing(file, { drawing = false }) { edits[message.id] = it; drawing = false }
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { NativeText("Удалить фото?") }, text = { NativeText("Сообщение будет удалено из чата.") }, confirmButton = { TextButton(onClick = { deleting = false; run { val updated=onDelete(message);nativeMediaFile(context,token,message).delete();window.remove(message.id);onAction(updated,"deleted") } }) { NativeText("Удалить") } }, dismissButton = { TextButton(onClick = { deleting = false }) { NativeText("Отмена") } })
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
