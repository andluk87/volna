package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.Icon
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal data class NativeChatEvent(val messages: List<VolnaMessage> = emptyList(), val call: VolnaCallRecord? = null) {
    val created: Long get() = call?.created ?: java.time.Instant.parse(messages.first().createdAt).toEpochMilli()
    val createdIso: String get() = java.time.Instant.ofEpochMilli(created).toString()
    val key: String get() = call?.let { "call-${it.id}" } ?: "message-${messages.first().id}"
}
internal fun nativeChatTimeline(groups: List<List<VolnaMessage>>, calls: List<VolnaCallRecord>): List<NativeChatEvent> =
    (groups.map { NativeChatEvent(messages = it) } + calls.map { NativeChatEvent(call = it) }).sortedWith(compareBy<NativeChatEvent> { it.created }.thenBy { it.key })

@Composable
internal fun rememberNativeChatCalls(token: String, account: Long, chat: VolnaChat, oldest: Long?, enabled: Boolean, pages: Int = 1): List<VolnaCallRecord> {
    val context = LocalContext.current
    val cache = remember { NativeCache(context) }
    DisposableEffect(cache) { onDispose { cache.close() } }
    var records by remember(account, chat.id) { mutableStateOf(cache.calls(account).filter { it.chatId == chat.id }) }
    val live by NativeCalls.state.collectAsState()
    LaunchedEffect(token, account, chat.id, enabled, oldest, pages, live.call?.id) {
        if (!enabled || chat.kind != "direct" || chat.saved) return@LaunchedEffect
        val api = NativeApi(BuildConfig.API_BASE_URL)
        while (isActive) {
            try {
                val rows = withContext(Dispatchers.IO) {
                    val all = mutableListOf<VolnaCallRecord>(); var before: Long? = null
                    do {
                        val page = api.callHistory(token, before, chat.id); all.addAll(page)
                        before = page.lastOrNull()?.created
                    } while (page.size == 50 && before != null && (all.size < pages * 50 || oldest != null && before > oldest) && all.size < 1000)
                    val completed = all.distinctBy { it.id }.filter { it.status !in listOf("preparing", "ringing", "connecting", "active") }
                    completed
                }
                records = rows
                if ((context as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) == true) {
                    withContext(Dispatchers.IO) { runCatching { api.readCalls(token, chat.id, rows.filter { it.incoming }.map { it.id }) } }
                }
                withContext(Dispatchers.IO) { cache.saveCalls(account, (rows + cache.calls(account).filter { it.chatId != chat.id }).sortedByDescending { it.created }) }
            } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Keep the last cached history offline. */ }
            delay(10_000)
        }
    }
    return if (!enabled) emptyList() else records.filter { oldest == null || it.created >= oldest }
}

internal fun nativeCallRecordTitle(call: VolnaCallRecord): String = when {
    call.duration > 0 || call.status == "ended" -> if (call.incoming) "Входящий звонок" else "Исходящий звонок"
    call.incoming -> "Пропущенный звонок"
    else -> "Отменённый звонок"
}
@Composable
internal fun NativeChatCallCard(call: VolnaCallRecord, enabled: Boolean, onCall: () -> Unit) {
    val missed = call.duration == 0 && call.status != "ended"
    val arrow = if (missed) Color(0xFFFF6670) else Accent
    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val cardWidth = 270.dp.coerceAtMost(maxWidth)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (call.incoming) Arrangement.Start else Arrangement.End) {
        Row(Modifier.testTag("call-card-${call.id}").width(cardWidth).heightIn(min = 56.dp).clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = if (call.incoming) 4.dp else 16.dp, bottomEnd = if (call.incoming) 16.dp else 4.dp)).background(if (call.incoming) Panel else Outgoing).clickable(enabled = enabled, onClick = onCall).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                NativeText(nativeCallRecordTitle(call), color = TextMain, fontSize = 16.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Medium)
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (call.incoming) Icons.Outlined.SouthWest else Icons.Outlined.NorthEast, null, tint = arrow, modifier = Modifier.size(16.dp))
                    val duration = if (call.duration > 0) if (call.duration < 60) "${call.duration} сек." else "${call.duration / 60} мин." else ""
                    NativeText(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(call.created)) + if (duration.isBlank()) "" else ", $duration", color = Muted, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, modifier = Modifier.padding(start = 4.dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Icon(if (call.video) Icons.Outlined.Videocam else Icons.Outlined.Call, if (call.video) "Повторить видеозвонок" else "Повторить звонок", tint = Accent, modifier = Modifier.size(24.dp))
        }
    }
    }
}
