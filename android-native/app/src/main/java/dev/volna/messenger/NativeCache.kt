package dev.volna.messenger

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** Small account-scoped snapshots. Network history remains the source of truth. */
class NativeCache(context: Context) : SQLiteOpenHelper(context.applicationContext, "volna-cache.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE snapshots(account INTEGER NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,touched INTEGER NOT NULL,PRIMARY KEY(account,key))") }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    @Synchronized private fun read(account: Long, key: String): String? = readableDatabase.rawQuery("SELECT value FROM snapshots WHERE account=? AND key=?", arrayOf(account.toString(), key)).use { if (it.moveToFirst()) it.getString(0) else null }
    @Synchronized private fun write(account: Long, key: String, value: String) {
        if (account <= 0 || read(account, key) == value) return
        writableDatabase.insertWithOnConflict("snapshots", null, ContentValues().apply {
            put("account", account); put("key", key); put("value", value); put("touched", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
        writableDatabase.execSQL("DELETE FROM snapshots WHERE account=? AND key LIKE 'messages-%' AND key NOT IN (SELECT key FROM snapshots WHERE account=? AND key LIKE 'messages-%' ORDER BY touched DESC LIMIT 50)", arrayOf(account, account))
        writableDatabase.execSQL("DELETE FROM snapshots WHERE account=? AND key LIKE 'profile-%' AND key NOT IN (SELECT key FROM snapshots WHERE account=? AND key LIKE 'profile-%' ORDER BY touched DESC LIMIT 100)", arrayOf(account, account))
    }
    fun me(account: Long): VolnaUser? = runCatching { read(account, "me")?.let { NativeCodec.user(JSONObject(it)) } }.getOrNull()
    fun saveMe(user: VolnaUser) = write(user.id, "me", NativeCodec.user(user).toString())
    fun chats(account: Long): List<VolnaChat> = runCatching { read(account, "chats")?.let { NativeCodec.chats(JSONArray(it)) } ?: emptyList() }.getOrDefault(emptyList())
    fun saveChats(account: Long, chats: List<VolnaChat>) = write(account, "chats", JSONArray(chats.map(NativeCodec::chat)).toString())
    fun messages(account: Long, chat: Long): List<VolnaMessage> = runCatching { read(account, "messages-$chat")?.let { rows -> JSONArray(rows).let { array -> (0 until array.length()).map { NativeCodec.message(array.getJSONObject(it)) } } } ?: emptyList() }.getOrDefault(emptyList())
    fun saveMessages(account: Long, chat: Long, messages: List<VolnaMessage>) = write(account, "messages-$chat", JSONArray(messages.takeLast(500).map(NativeCodec::message)).toString())
    fun contacts(account: Long): List<VolnaUser> = runCatching { read(account, "contacts")?.let { JSONArray(it).let { rows -> (0 until rows.length()).map { NativeCodec.user(rows.getJSONObject(it)) } } } ?: emptyList() }.getOrDefault(emptyList())
    fun saveContacts(account: Long, users: List<VolnaUser>) = write(account, "contacts", JSONArray(users.map(NativeCodec::user)).toString())
    fun profile(account: Long, user: Long): VolnaUser? = runCatching { read(account, "profile-$user")?.let { NativeCodec.user(JSONObject(it)) } }.getOrNull()
    fun saveProfile(account: Long, user: VolnaUser) = write(account, "profile-${user.id}", NativeCodec.user(user).toString())
    fun calls(account: Long): List<VolnaCallRecord> = runCatching { read(account, "calls")?.let { value -> JSONArray(value).let { rows -> (0 until rows.length()).map { NativeCodec.call(rows.getJSONObject(it)) } } } ?: emptyList() }.getOrDefault(emptyList())
    fun saveCalls(account: Long, calls: List<VolnaCallRecord>) = write(account, "calls", JSONArray(calls.take(200).map(NativeCodec::call)).toString())
    @Synchronized fun clear(account: Long) { writableDatabase.delete("snapshots", "account=?", arrayOf(account.toString())) }
}

internal object NativeCodec {
    fun call(c: VolnaCallRecord): JSONObject = JSONObject().put("id", c.id).put("chat", c.chatId).put("peer", c.peer?.let(::user)).put("incoming", c.incoming).put("at", c.created).put("status", c.status).put("duration", c.duration).put("screen", c.screenShared).put("video", c.video)
    fun call(o: JSONObject): VolnaCallRecord = VolnaCallRecord(o.getString("id"), o.getLong("chat"), o.optJSONObject("peer")?.let(::user), o.optBoolean("incoming"), o.getLong("at"), o.getString("status"), o.optInt("duration"), o.optBoolean("screen"), o.optBoolean("video"))
    fun user(u: VolnaUser): JSONObject = JSONObject().put("id", u.id).put("name", u.name).put("username", u.username).put("avatar", u.avatarUrl)
        .put("bio", u.bio).put("phone", u.phone)
    fun user(o: JSONObject): VolnaUser = VolnaUser(o.getLong("id"), o.optString("username"), o.optString("name"), text(o, "avatar"), o.optString("bio"), o.optString("phone"))
    fun chat(c: VolnaChat): JSONObject = JSONObject().put("id", c.id).put("name", c.name).put("username", c.username).put("last", c.lastText).put("at", c.lastAt).put("unread", c.unread).put("saved", c.saved).put("peer", c.peerId).put("read", c.peerRead).put("delivered", c.peerDelivered).put("kind", c.kind).put("archived", c.archived).put("muted", c.muted).put("pinned", c.pinned).put("role", c.role).put("send", c.canSend).put("count", c.memberCount).put("avatar", c.avatarUrl).put("lastId", c.lastId).put("lastSender", c.lastSenderId).put("parent", c.parentId).put("topicClosed", c.topicClosed)
    fun chats(rows: JSONArray): List<VolnaChat> = (0 until rows.length()).map { i -> val o = rows.getJSONObject(i); VolnaChat(o.getLong("id"), o.optString("name"), o.optString("username"), o.optString("last"), o.optString("at"), o.optInt("unread"), o.optBoolean("saved"), o.optLong("peer"), o.optLong("read"), o.optLong("delivered"), o.optString("kind", "direct"), o.optBoolean("archived"), o.optBoolean("muted"), o.optBoolean("pinned"), o.optString("role", "member"), o.optBoolean("send", true), o.optInt("count"), text(o, "avatar"), o.optLong("lastId"), o.optLong("lastSender"), parentId = o.optLong("parent"), topicClosed = o.optBoolean("topicClosed")) }
    fun message(m: VolnaMessage): JSONObject = JSONObject().put("id", m.id).put("sender", m.senderId).put("name", m.senderName).put("text", m.text).put("at", m.createdAt).put("deleted", m.deleted).put("fileName", m.attachmentName).put("file", m.attachmentId).put("mime", m.attachmentMime).put("size", m.attachmentSize).put("album", m.albumId).put("chat", m.chatId).put("edited", m.edited).put("pinned", m.pinned).put("transcript", m.transcript).put("forward", m.forwardedName).put("expressionKind", m.expressionKind).put("expressionId", m.expressionId).put("emojiEntities", JSONArray(m.emojiEntities.map { it.json() }))
        .put("reply", m.reply?.let { JSONObject().put("id", it.id).put("name", it.name).put("text", it.text).put("deleted", it.deleted) })
        .put("reactions", JSONArray(m.reactions.map { JSONObject().put("emoji", it.emoji).put("user", it.userId).put("name", it.name) }))
    fun message(o: JSONObject): VolnaMessage = VolnaMessage(o.getLong("id"), o.optLong("sender"), o.optString("name"), o.optString("text"), o.optString("at"), o.optBoolean("deleted"), text(o, "fileName"), text(o, "file"), text(o, "mime"), o.optJSONObject("reply")?.let { VolnaReply(it.getLong("id"), it.optString("name"), it.optString("text"), it.optBoolean("deleted")) }, o.optJSONArray("reactions")?.let { rows -> (0 until rows.length()).map { rows.getJSONObject(it).let { r -> VolnaReaction(r.optString("emoji"), r.optLong("user"), r.optString("name")) } } } ?: emptyList(), o.optBoolean("edited"), o.optBoolean("pinned"), text(o, "transcript"), text(o, "forward"), o.optLong("size"), text(o, "album"), o.optLong("chat"), text(o, "expressionKind"), text(o, "expressionId"), o.optJSONArray("emojiEntities")?.let { a -> (0 until a.length()).map { NativeEmojiEntity.parse(a.getJSONObject(it)) } } ?: emptyList())
    private fun text(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key).takeIf { it.isNotBlank() && it != "null" }
}

internal class NativeDrafts(context: Context, private val account: Long) {
    private val prefs = context.getSharedPreferences("volna-drafts-$account", Context.MODE_PRIVATE)
    fun get(chat: Long): String = prefs.getString(chat.toString(), "").orEmpty()
    fun set(chat: Long, text: String) { prefs.edit().apply { if (text.isBlank()) remove(chat.toString()) else putString(chat.toString(), text.take(4000)) }.apply() }
    fun input(chat: Long): androidx.compose.ui.text.input.TextFieldValue {
        val text = get(chat)
        return androidx.compose.ui.text.input.TextFieldValue(text, androidx.compose.ui.text.TextRange(prefs.getInt("selection-start:$chat", text.length).coerceIn(0, text.length), prefs.getInt("selection-end:$chat", text.length).coerceIn(0, text.length)))
    }
    fun entities(chat: Long): List<NativeEmojiEntity> = runCatching { JSONArray(prefs.getString("entities:$chat", "[]")).let { a -> (0 until a.length()).map { NativeEmojiEntity.parse(a.getJSONObject(it)) } } }.getOrDefault(emptyList())
    fun setInput(chat: Long, value: androidx.compose.ui.text.input.TextFieldValue, entities: List<NativeEmojiEntity>) {
        set(chat, value.text)
        prefs.edit().putInt("selection-start:$chat", value.selection.start).putInt("selection-end:$chat", value.selection.end).putString("entities:$chat", JSONArray(entities.map { it.json() }).toString()).apply()
    }
    fun clear() { prefs.edit().clear().apply() }
}

internal data class NativeAccount(val user: VolnaUser, val token: String)
internal object NativeAccounts {
    fun list(context: Context): List<NativeAccount> = runCatching {
        val rows = JSONArray(context.getSharedPreferences("volna-accounts", 0).getString("accounts", "[]"))
        (0 until rows.length()).map { i -> rows.getJSONObject(i).let { NativeAccount(NativeCodec.user(it.getJSONObject("user")), NativeCredentials.access(it.getJSONObject("user").getLong("id"))) } }
    }.getOrDefault(emptyList()).filter { it.token.isNotBlank() }
    fun remember(context: Context, user: VolnaUser, token: String) = save(context, list(context).filter { it.user.id != user.id } + NativeAccount(user, token))
    fun remove(context: Context, id: Long) { NativeCredentials.remove(id); save(context, list(context).filter { it.user.id != id }) }
    private fun save(context: Context, accounts: List<NativeAccount>) { context.getSharedPreferences("volna-accounts", 0).edit().putString("accounts", JSONArray(accounts.takeLast(5).map { JSONObject().put("user", NativeCodec.user(it.user)) }).toString()).apply() }
}
