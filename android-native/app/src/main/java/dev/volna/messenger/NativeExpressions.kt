package dev.volna.messenger

import android.content.Context
import android.graphics.drawable.Animatable
import android.net.Uri
import android.widget.VideoView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil.compose.AsyncImage
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

internal data class NativeExpression(val id: String, val packId: String, val kind: String, val label: String,
    val keywords: List<String>, val fallback: String, val attachmentId: String, val mime: String,
    val size: Long, val packTitle: String, val favorite: Boolean = false) {
    fun json() = JSONObject().put("id", id).put("pack_id", packId).put("kind", kind).put("label", label)
        .put("keywords", JSONArray(keywords)).put("fallback", fallback).put("attachment_id", attachmentId)
        .put("mime", mime).put("size", size).put("pack_title", packTitle).put("favorite", favorite)
    companion object {
        fun parse(row: JSONObject) = NativeExpression(row.getString("id"), row.getString("pack_id"), row.optString("kind", "sticker"), row.optString("label"),
            row.optJSONArray("keywords")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList(), row.optString("fallback", "✨"), row.getString("attachment_id"), row.getString("mime"), row.optLong("size"), row.optString("pack_title"), row.optBoolean("favorite"))
        fun parseList(rows: JSONArray?): List<NativeExpression> = if (rows == null) emptyList() else (0 until rows.length()).map { parse(rows.getJSONObject(it)) }
    }
}
internal data class NativeExpressionPage(val items: List<NativeExpression>, val more: Boolean, val offset: Int)
internal data class NativeExpressionPack(val id: String, val title: String, val kind: String, val installed: Boolean,
    val own: Boolean, val isPublic: Boolean, val items: List<NativeExpression>) {
    fun json() = JSONObject().put("id", id).put("title", title).put("kind", kind).put("installed", installed)
        .put("own", own).put("public", isPublic).put("items", JSONArray(items.map { it.json() }))
    companion object {
        fun parse(row: JSONObject): NativeExpressionPack {
            val kind = row.getString("kind"); val title = row.getString("title")
            return NativeExpressionPack(row.getString("id"), title, kind, row.optBoolean("installed"), row.optBoolean("own"), row.optBoolean("public"), NativeExpression.parseList(row.optJSONArray("items")).map { it.copy(kind = kind, packTitle = title) })
        }
    }
}
internal class NativeExpressionStore(context: Context, val account: Long) {
    private val prefs = context.getSharedPreferences("volna-expressions-$account", 0)
    private val directory = File(context.cacheDir, "expressions/$account")
    var lastTab: String
        get() = prefs.getString("tab", "emoji").orEmpty().takeIf { it in listOf("emoji", "sticker", "gif") } ?: "emoji"
        set(value) { prefs.edit().putString("tab", value).apply() }
    fun packs(): List<NativeExpressionPack> = runCatching { JSONArray(prefs.getString("packs", "[]")).let { a -> (0 until a.length()).map { NativeExpressionPack.parse(a.getJSONObject(it)) } } }.getOrDefault(emptyList())
    fun savePacks(packs: List<NativeExpressionPack>) {
        val items = packs.flatMap { it.items }; val ids = items.map { it.id }.toSet()
        var selected = (favorites() - ids) + items.filter { it.favorite }.map { it.id }
        pendingFavorites().forEach { (id, active) -> selected = if (active) selected + id else selected - id }
        prefs.edit().putString("packs", JSONArray(packs.take(100).map { it.json() }).toString()).putStringSet("favorites", selected)
            .putString("favoriteItems", JSONArray((items.filter { it.id in selected } + favoriteItems().filter { it.id !in ids && it.id in selected }).distinctBy { it.id }.take(200).map { it.json() }).toString()).apply()
    }
    fun recentEmoji(): List<String> = runCatching { JSONObject(prefs.getString("emoji", "{}")).let { o -> o.keys().asSequence().sortedWith(compareByDescending<String> { o.getJSONObject(it).optLong("used") }.thenByDescending { o.getJSONObject(it).optInt("count") }).take(80).toList() } }.getOrDefault(emptyList())
    fun useEmoji(text: String) {
        val rows = runCatching { JSONObject(prefs.getString("emoji", "{}")) }.getOrDefault(JSONObject())
        rows.put(text, JSONObject().put("used", System.currentTimeMillis()).put("count", (rows.optJSONObject(text)?.optInt("count") ?: 0) + 1))
        if (rows.length() > 100) rows.keys().asSequence().minByOrNull { rows.getJSONObject(it).optLong("used") }?.let(rows::remove)
        prefs.edit().putString("emoji", rows.toString()).apply()
    }
    fun preferredSkin(entry: NativeEmojiEntry, catalog: NativeEmojiCatalog): NativeEmojiEntry = prefs.getString("skin:${entry.base}", null)?.let { catalog.lookup[it] } ?: entry
    fun setSkin(entry: NativeEmojiEntry) { prefs.edit().putString("skin:${entry.base}", entry.text).apply() }
    fun recent(): List<NativeExpression> = runCatching { NativeExpression.parseList(JSONArray(prefs.getString("recent", "[]"))) }.getOrDefault(emptyList())
    fun used(item: NativeExpression) { prefs.edit().putString("recent", JSONArray((listOf(item) + recent().filter { it.id != item.id }).take(100).map { it.json() }).toString()).apply() }
    fun favorites(): Set<String> = prefs.getStringSet("favorites", emptySet()).orEmpty().toSet()
    fun favorite(item: NativeExpression, active: Boolean) {
        prefs.edit().putBoolean("pending-favorite:${item.id}", active).putStringSet("favorites", if (active) favorites() + item.id else favorites() - item.id).putString("favoriteItems", JSONArray((if (active) listOf(item.copy(favorite = true)) + favoriteItems().filter { it.id != item.id } else favoriteItems().filter { it.id != item.id }).take(200).map { it.json() }).toString()).apply()
    }
    fun pendingFavorites(): Map<String, Boolean> = prefs.all.filterKeys { it.startsWith("pending-favorite:") }.mapNotNull { (key, value) -> if (value is Boolean) key.removePrefix("pending-favorite:") to value else null }.toMap()
    fun favoriteSynced(id: String) { prefs.edit().remove("pending-favorite:$id").apply() }
    fun favoriteItems(): List<NativeExpression> = runCatching { NativeExpression.parseList(JSONArray(prefs.getString("favoriteItems", "[]"))) }.getOrDefault(emptyList())
    private fun filename(item: NativeExpression) = item.attachmentId + "." + when (item.mime) { "image/png" -> "png"; "image/jpeg" -> "jpg"; "image/gif" -> "gif"; "video/mp4" -> "mp4"; "video/webm" -> "webm"; else -> "webp" }
    fun cached(item: NativeExpression): File? = File(directory, filename(item)).takeIf { it.isFile && it.length() > 0 }
    suspend fun cache(api: NativeApi, token: String, item: NativeExpression): File = withContext(Dispatchers.IO) {
        val file = File(directory, filename(item))
        synchronized(locks.getOrPut("$account:${item.attachmentId}") { Any() }) {
            if (!file.isFile || file.length() == 0L) { directory.mkdirs(); api.downloadAttachment(token, item.attachmentId, file) }
            file.setLastModified(System.currentTimeMillis())
            val files = directory.listFiles()?.filter { it.isFile && it.name.matches(Regex("[a-f0-9]{48}\\.(png|jpg|gif|webp|mp4|webm)")) }.orEmpty()
            var size = files.sumOf { it.length() }
            files.sortedBy { it.lastModified() }.forEach { old -> if (size > 100L * 1024 * 1024 && old != file) { val bytes = old.length(); if (old.delete()) size -= bytes } }
            file
        }
    }
    companion object { private val locks = ConcurrentHashMap<String, Any>() }
}

@Composable
internal fun NativeExpressionImage(item: NativeExpression, token: String, api: NativeApi, store: NativeExpressionStore,
    modifier: Modifier = Modifier, play: Boolean = false) {
    val context = LocalContext.current
    val motion = LocalMotionEnabled.current && play && nativeScreenActive()
    var file by remember(item.attachmentId, store.account) { mutableStateOf(store.cached(item)) }
    var error by remember(item.attachmentId, store.account) { mutableStateOf(false) }
    var ready by remember(item.attachmentId, file) { mutableStateOf(false) }
    var retry by remember(item.attachmentId) { mutableStateOf(0) }
    LaunchedEffect(item.attachmentId, store.account, token, retry) {
        if (file == null) {
            error = false
            try { file = store.cache(api, token, item) }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { error = true }
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
    if (!ready && item.kind == "emoji") NativeText(item.fallback, color = TextMain, fontSize = 18.sp)
    if (file == null) {
        if (item.kind != "emoji") Box(Modifier.fillMaxSize().background(Input), contentAlignment = Alignment.Center) {
            Icon(if (error) Icons.Outlined.Refresh else Icons.Outlined.Image, if (error) "Повторить загрузку ${item.label}" else item.label,
                Modifier.size(24.dp).then(if (error) Modifier.clickable { retry++ } else Modifier), tint = Muted)
        }
    } else
    if (item.mime.startsWith("video/") && motion && file != null) {
        var view by remember(item.id) { mutableStateOf<VideoView?>(null) }
        AndroidView(factory = { ctx -> VideoView(ctx).apply { view = this; setVideoURI(Uri.fromFile(file)); setOnPreparedListener { player -> ready = true; player.isLooping = true; player.setVolume(0f, 0f); start() }; setOnErrorListener { _, _, _ -> error = true; true } } }, modifier = Modifier.fillMaxSize())
        DisposableEffect(view) {
            val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) view?.pause() else if (event == Lifecycle.Event.ON_START) view?.start() }
            (context as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.addObserver(observer)
            onDispose { (context as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.removeObserver(observer); view?.stopPlayback() }
        }
    } else {
        var animation by remember(item.id) { mutableStateOf<Animatable?>(null) }
        AsyncImage(model = file, contentDescription = item.label,
            modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit,
            onSuccess = { state -> ready = true; error = false; animation = state.result.drawable as? Animatable }, onError = { error = true })
        DisposableEffect(animation, motion) { if (motion) animation?.start() else animation?.stop(); onDispose { animation?.stop() } }
    }
    if (error && file != null && item.kind != "emoji") Icon(Icons.Outlined.Refresh, "Повторить загрузку ${item.label}",
        Modifier.size(32.dp).background(Input).clickable { file?.delete(); file = null; retry++ }, tint = Muted)
    }
}

internal object NativeExpressionHttp { val api: NativeApi by lazy { NativeApi(BuildConfig.API_BASE_URL) } }
