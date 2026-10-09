package dev.volna.messenger

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PlayCircleOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import java.util.UUID

internal data class NativeSelectedAttachment(val uri: Uri, val name: String, val mime: String)
internal class NativeAttachmentBatch(val chatId: Long, val files: List<NativeSelectedAttachment>, val initialCaption: String, val replyId: Long?, val onSent: () -> Unit,
    val clientId: String = UUID.randomUUID().toString().replace("-", ""), val voiceFile: java.io.File? = null, val account: Long = 0) {
    val uploads = mutableMapOf<Int, String>()
    var caption: String? = null
}

internal fun selectedAttachments(resolver: ContentResolver, uris: List<Uri>): List<NativeSelectedAttachment> {
    val selected = uris.distinct()
    require(selected.size in 1..10) { "Выберите не больше 10 вложений" }
    return selected.map { uri ->
        var name = "Вложение"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0) name = cursor.getString(column).orEmpty().ifBlank { "Вложение" }
                val size = cursor.getColumnIndex(OpenableColumns.SIZE)
                require(size < 0 || cursor.isNull(size) || cursor.getLong(size) <= 20L * 1024 * 1024) { "$name: максимальный размер — 20 МБ" }
            }
        }
        NativeSelectedAttachment(uri, name, resolver.getType(uri) ?: "application/octet-stream")
    }
}

@Composable
internal fun NativeAttachmentComposer(batch: NativeAttachmentBatch, busy: Boolean, status: String, error: String, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var caption by remember(batch.clientId) { mutableStateOf(batch.initialCaption) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { NativeText(if (batch.voiceFile != null) "Голосовое не отправлено" else if (batch.files.size == 1) "Отправить вложение" else "Отправить ${batch.files.size} вложений") }, text = {
        Column {
            if (batch.voiceFile != null) NativeText("Запись сохранена на устройстве. Повторите отправку, когда появится сеть.", color = Muted, fontSize = 13.sp)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(batch.files, key = { it.uri.toString() }) { file ->
                    Box(Modifier.size(92.dp).clip(RoundedCornerShape(10.dp)).background(Input), contentAlignment = Alignment.Center) {
                        if (file.mime.startsWith("image/")) AsyncImage(file.uri, "Предпросмотр фото", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        else Icon(if (file.mime.startsWith("video/")) Icons.Outlined.PlayCircleOutline else Icons.Outlined.Description, file.name, tint = Accent)
                    }
                }
            }
            if (batch.voiceFile == null) NativeOutlinedTextField(caption, { caption = it.take(4000) }, label = { NativeText("Подпись (необязательно)") }, maxLines = 4,
                enabled = !busy && batch.caption == null, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            if (busy) NativeText(status.ifBlank { "Отправляем…" }, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = { onSend(caption.trim()) }) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else NativeText(if (error.isBlank()) "Отправить" else "Повторить") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { NativeText("Отмена") } })
}

internal fun nativeMessageGroups(messages: List<VolnaMessage>): List<List<VolnaMessage>> {
    val groups = mutableListOf<MutableList<VolnaMessage>>()
    messages.forEach { message ->
        val previous = groups.lastOrNull()?.lastOrNull()
        if (!message.deleted && message.albumId != null && previous != null && previous.albumId == message.albumId && !previous.deleted && previous.senderId == message.senderId) groups.last().add(message)
        else groups.add(mutableListOf(message))
    }
    return groups
}
