package dev.volna.messenger

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun nativeTopicRows(value: JSONObject, admin: Boolean): List<JSONObject> {
    val rows = value.optJSONArray("topics")
    return (listOfNotNull(value.optJSONObject("general")) +
        if (rows == null) emptyList() else (0 until rows.length()).map { rows.getJSONObject(it) })
        .filter { !it.optBoolean("hidden") || admin }
        .sortedWith(compareByDescending<JSONObject> { it.optBoolean("pinned") }
            .thenBy { if (it.optBoolean("pinned")) it.optInt("pin_order") else Int.MAX_VALUE }
            .thenByDescending { it.optString("last_at").takeUnless { time -> time == "null" }.orEmpty() })
}

internal fun nativeTopicDate(value: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String = runCatching {
    val time = Instant.parse(value).atZone(zone)
    val today = now.atZone(zone).toLocalDate()
    val pattern = if (time.toLocalDate() == today) "HH:mm" else if (time.year == today.year) "d MMM" else "d MMM yy"
    time.format(DateTimeFormatter.ofPattern(pattern, Locale.forLanguageTag("ru")))
}.getOrDefault("")

@Composable
internal fun NativeTopicRow(topic: JSONObject, busy: Boolean, onSelect: () -> Unit, onActions: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onSelect).padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        NativeText(topic.optString("icon").ifBlank { "#" }, color = Accent, fontSize = 23.sp,
            modifier = Modifier.width(34.dp), maxLines = 1)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                NativeText(topic.optString("name"), Modifier.weight(1f), color = TextMain, fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (topic.optBoolean("pinned")) NativeText(" 📌", fontSize = 12.sp)
                if (topic.optBoolean("closed")) NativeText(" 🔒", fontSize = 12.sp)
                NativeText(nativeTopicDate(topic.optString("last_at")), Modifier.padding(start = 6.dp), color = Muted, fontSize = 11.sp)
            }
            Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                val preview = if (topic.optBoolean("hidden")) "Скрыта из списка" else topic.optString("last_text")
                    .ifBlank { topic.optString("description").takeUnless { topic.optBoolean("general") }.orEmpty() }
                    .ifBlank { "Пока нет сообщений" }
                NativeText(preview, Modifier.weight(1f), color = Muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                NativeUnreadBadge(topic.optInt("unread_count"), Modifier.padding(start = 6.dp))
            }
        }
        IconButton(onClick = onActions, enabled = !busy) {
            Icon(Icons.Outlined.MoreVert, "Действия темы ${topic.optString("name")}", tint = Muted)
        }
    }
    HorizontalDivider(Modifier.padding(start = 48.dp), color = Muted.copy(alpha = .12f))
}
