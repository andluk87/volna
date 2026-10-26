package dev.volna.messenger

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

internal fun nativeTopicParent(chat: VolnaChat?, chats: List<VolnaChat>): VolnaChat? = chat?.let { current ->
    if (current.parentId != 0L) chats.firstOrNull { it.id == current.parentId }
    else current.takeIf { it.kind == "group" && (it.topicsEnabled || chats.any { row -> row.parentId == it.id }) }
}

internal fun nativeTopicRows(info: JSONObject?): List<JSONObject> {
    val topics = info?.optJSONArray("topics")
    return (listOfNotNull(info?.optJSONObject("general")) + if (topics == null) emptyList() else (0 until topics.length()).map { topics.getJSONObject(it) })
        .sortedWith(compareByDescending<JSONObject> { it.optBoolean("pinned") }
            .thenBy { if (it.optBoolean("pinned")) it.optInt("pin_order") else 0 }
            .thenByDescending { it.optLong("last_id") }.thenBy { it.optLong("id") })
}

internal fun nativeTopicPreview(topic: JSONObject): String {
    val text = topic.optString("last_text").ifBlank { topic.optString("description").ifBlank { "Пока нет сообщений" } }
    return topic.optString("last_sender").takeIf { it.isNotBlank() && topic.optLong("last_id") > 0 }?.let { "$it: $text" } ?: text
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeTopicRow(topic: JSONObject, onClick: () -> Unit, onLongClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(shape = CircleShape, color = Accent.copy(alpha = .18f), modifier = Modifier.size(48.dp)) {
            Box(contentAlignment = Alignment.Center) { NativeText(topic.optString("icon").ifBlank { "#" }, fontSize = 28.sp) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                NativeText(topic.optString("name"), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (topic.optString("notification_mode") in listOf("none", "silent")) NativeText(" 🔕", fontSize = 12.sp)
                if (topic.optBoolean("closed")) NativeText(" 🔒", fontSize = 12.sp)
                if (topic.optBoolean("pinned")) NativeText(" 📌", fontSize = 12.sp)
            }
            NativeText(nativeTopicPreview(topic), color = Muted, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (topic.optBoolean("hidden")) NativeText("Скрыта из списка", color = Muted, fontSize = 11.sp)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val time = remember(topic.optString("last_at")) { runCatching { java.time.Instant.parse(topic.optString("last_at")).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")) }.getOrDefault("") }
            NativeText(time, color = Muted, fontSize = 11.sp)
            if (topic.optInt("unread_count") > 0) Badge(containerColor = Accent, contentColor = MaterialTheme.colorScheme.onPrimary) { NativeText(topic.optInt("unread_count").toString()) }
        }
    }
}

@Composable
internal fun NativeTopicEmojiPicker(onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val catalog = LocalEmojiCatalog.current
    var query by remember { mutableStateOf("") }; var category by remember { mutableStateOf("") }
    val categories = listOf("" to "Все", "faces" to "😀", "people" to "👋", "animals" to "🌿", "food" to "🍎", "travel" to "🚀", "activities" to "⚽", "objects" to "💡", "symbols" to "❤️", "flags" to "🏁")
    val rows = remember(query, category, catalog) {
        (if (query.isBlank()) catalog?.entries.orEmpty() else catalog?.search(query).orEmpty()).filter { category.isBlank() || it.group == category }.distinctBy { it.text }
    }
    NativeFullScreen("Значок темы", onDismiss) {
        NativeOutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(12.dp), label = { NativeText("Найти эмодзи") }, singleLine = true)
        androidx.compose.foundation.lazy.LazyRow(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
            items(categories.size) { i -> val (key, label) = categories[i]; FilterChip(selected = category == key, onClick = { category = key; query = "" }, label = { NativeText(label) }, modifier = Modifier.padding(end = 4.dp)) }
        }
        TextButton(onClick = { onPick("") }) { NativeText("Стандартный значок") }
        LazyVerticalGrid(columns = GridCells.Adaptive(46.dp), modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp)) {
            items(rows, key = { it.text }) { emoji -> TextButton(onClick = { onPick(emoji.text) }, modifier = Modifier.height(48.dp), contentPadding = PaddingValues(0.dp)) { NativeText(emoji.text, fontSize = 28.sp) } }
        }
    }
}
