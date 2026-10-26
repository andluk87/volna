package dev.volna.messenger

import android.content.Context
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.concurrent.ConcurrentHashMap

internal data class NativeMediaPage(val items: List<VolnaMessage>, val before: String?, val after: String?, val hasBefore: Boolean, val hasAfter: Boolean)
internal fun isTimelineMedia(m: VolnaMessage) = !m.deleted && m.expressionKind == null && (m.attachmentMime?.startsWith("image/") == true || m.attachmentMime?.startsWith("video/") == true)
internal class NativeMediaWindow(initial: VolnaMessage, seed: List<VolnaMessage>, private val token: String, private val api: NativeApi, private val fetchPage: (suspend (String,String?) -> NativeMediaPage)? = null) {
    var items by mutableStateOf((seed + initial).filter { it.chatId == initial.chatId && isTimelineMedia(it) }.distinctBy { it.id }.sortedBy { it.id }); private set
    var selected by mutableStateOf(initial.id)
    var before by mutableStateOf<String?>(null); private set
    var after by mutableStateOf<String?>(null); private set
    var hasBefore by mutableStateOf(false); private set
    var hasAfter by mutableStateOf(false); private set
    var ready by mutableStateOf(false); private set
    var denied by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var loading by mutableStateOf(false); private set
    private val pending = mutableSetOf<String>()
    private val removed = mutableSetOf<Long>()
    private val chat = initial.chatId
    private val anchor = initial.id
    val index get() = items.indexOfFirst { it.id == selected }
    val current get() = items.firstOrNull { it.id == selected }
    val complete get() = ready && !hasBefore && !hasAfter
    suspend fun load(direction: String = "around") {
        if (direction in pending || direction == "before" && !hasBefore || direction == "after" && !hasAfter) return
        pending.add(direction); loading = true
        try {
            val cursor=if(direction=="before")before else if(direction=="after")after else null
            val page = if(fetchPage!=null)fetchPage.invoke(direction,cursor) else withContext(Dispatchers.IO) { api.mediaPage(token, chat, if(direction=="around") selected else anchor, direction,cursor) }
            val rows = page.items.filter { it.id !in removed }
            items = (if (direction == "around") rows else items + rows).distinctBy { it.id }.sortedBy { it.id }
            if (direction != "after") { before = page.before; hasBefore = page.hasBefore }
            if (direction != "before") { after = page.after; hasAfter = page.hasAfter }
            ready = true; error = ""
            if (items.none { it.id == selected }) selected = items.firstOrNull()?.id ?: 0
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить медиа"; if (problem is NativeApiException && problem.status in listOf(401,403,404)) { deny() } }
        finally { pending.remove(direction); loading = pending.isNotEmpty() }
    }
    fun update(m: VolnaMessage) {
        if (m.chatId != chat) return
        if (!isTimelineMedia(m)) { remove(m.id); return }
        // Keep the loaded range contiguous; new messages outside it are fetched through the cursor.
        if (items.any { it.id == m.id } || !hasAfter) items = (items.filter { it.id != m.id } + m).sortedBy { it.id }
    }
    fun remove(id: Long) { val old = items.indexOfFirst { it.id == id }; removed.add(id); items = items.filter { it.id != id }; if (selected == id) selected = items.getOrNull(old.coerceAtMost(items.lastIndex))?.id ?: 0 }
    fun deny() { items = emptyList(); denied = true; error = "Медиа недоступно: доступ к истории изменился" }
}
internal fun nativeMediaFile(context: Context, token: String, message: VolnaMessage): File {
    val name = message.attachmentName.orEmpty().replace(Regex("[\\\\/\\x00-\\x1f]"), "_").take(160).trim().trim('.').ifBlank { "Медиа" }
    return File(context.cacheDir, "attachments/media/${NativeCredentials.accountId(token)}/${message.attachmentId}/$name")
}
private val mediaLocks = ConcurrentHashMap<String, Mutex>()
internal suspend fun cachedNativeMedia(context: Context, token: String, message: VolnaMessage, api: NativeApi): File {
    val target = nativeMediaFile(context, token, message)
    return mediaLocks.getOrPut(target.path) { Mutex() }.withLock {
        if (!target.isFile || target.length() == 0L || message.attachmentSize > 0 && target.length() != message.attachmentSize) api.downloadMedia(token, message, target)
        withContext(Dispatchers.IO) {
            target.setLastModified(System.currentTimeMillis())
            val files = File(context.cacheDir, "attachments/media/${NativeCredentials.accountId(token)}").walkTopDown().filter { it.isFile && !it.name.endsWith(".part") }.toList()
            var bytes = files.sumOf { it.length() }; for (old in files.sortedBy { it.lastModified() }) if (bytes > 100L*1024*1024 && old != target) { val length = old.length(); if (old.delete()) bytes -= length }
        }; target
    }
}

internal fun nativeMediaDate(value: String): String = try { java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm",java.util.Locale("ru"))) }catch(_:Exception){value}
