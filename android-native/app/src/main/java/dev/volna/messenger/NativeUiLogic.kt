package dev.volna.messenger

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun nativeChatFilter(chat: VolnaChat, filter: String): Boolean = when (filter) {
    "archived" -> chat.archived
    "unread" -> !chat.archived && chat.unread > 0
    "direct" -> !chat.archived && chat.kind in listOf("direct", "saved")
    "group", "channel" -> !chat.archived && chat.kind == filter
    else -> !chat.archived
}

internal fun nativeSameAuthor(previous: VolnaMessage?, current: VolnaMessage): Boolean {
    if (previous == null || previous.deleted || current.deleted || previous.senderId != current.senderId) return false
    return runCatching { val gap = Instant.parse(current.createdAt).epochSecond - Instant.parse(previous.createdAt).epochSecond; gap in 0..300 }.getOrDefault(false)
}
internal fun nativeClock(value: String): String = runCatching { DateTimeFormatter.ofPattern("HH:mm", Locale("ru")).withZone(ZoneId.systemDefault()).format(Instant.parse(value)) }.getOrDefault("")
internal fun nativeDay(value: String): String = runCatching { DateTimeFormatter.ofPattern("d MMMM", Locale("ru")).withZone(ZoneId.systemDefault()).format(Instant.parse(value)) }.getOrDefault("")
internal fun nativeShouldFollow(lastVisible: Int, previousCount: Int, sender: Long, me: Long?): Boolean = sender == me || lastVisible >= previousCount - 2

/** Gesture thresholds are expressed in dp; tap recording remains supported. */
internal class NativeVoiceGesture {
    var cancelled = false; private set
    var locked = false; private set
    fun move(x: Float, y: Float) {
        if (locked || cancelled) return
        if (x <= -80f) cancelled = true else if (y <= -72f) locked = true
    }
    fun release(heldMs: Long): String = when { cancelled -> "cancel"; locked || heldMs < 250 -> "lock"; else -> "send" }
}
