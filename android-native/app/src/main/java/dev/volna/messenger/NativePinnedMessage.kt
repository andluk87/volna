package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Human-readable pinned preview; generated storage/recording names stay out of the banner. */
internal fun nativePinnedPreview(message: VolnaMessage): String {
    if (message.deleted) return "Сообщение удалено"
    val caption = message.text.replace(Regex("\\s+"), " ").trim()
    if (caption.isNotEmpty()) return caption
    val name = message.attachmentName.orEmpty().trim()
    val mime = message.attachmentMime.orEmpty().lowercase()
    val fileName = name.takeUnless { it.matches(Regex("[a-fA-F0-9]{24,}(?:\\.[A-Za-z0-9]{1,8})?")) }.orEmpty()
    return when {
        name.startsWith("Голосовое-", ignoreCase = true) && (mime.isBlank() || mime.startsWith("audio/")) -> "Голосовое сообщение"
        message.expressionKind == "sticker" || name.startsWith("Стикер-") -> "Стикер"
        message.expressionKind == "gif" || mime == "image/gif" -> "GIF"
        message.expressionKind == "emoji" -> "Эмодзи"
        mime.startsWith("image/") -> "Фото"
        mime.startsWith("video/") -> "Видео"
        mime.startsWith("audio/") -> fileName.ifBlank { "Аудиофайл" }
        message.attachmentId != null || name.isNotEmpty() -> fileName.ifBlank { "Файл" }
        else -> "Сообщение"
    }
}

@Composable
internal fun NativePinnedMessage(message: VolnaMessage, onJump: (Long) -> Unit, onShowAll: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp).clip(RoundedCornerShape(14.dp))
        .background(Panel.copy(alpha = .64f)).clickable { onJump(message.id) }.padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            repeat(3) { Box(Modifier.width(3.dp).height(9.dp).clip(CircleShape).background(Accent)) }
        }
        Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 7.dp)) {
            NativeText("Закреплённое сообщение", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            NativeText(nativePinnedPreview(message), color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onShowAll) { Icon(Icons.Outlined.PushPin, "Все закреплённые сообщения", tint = Muted) }
    }
}
