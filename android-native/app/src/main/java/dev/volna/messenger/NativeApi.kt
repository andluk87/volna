package dev.volna.messenger

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.net.URI

data class VolnaUser(
    val id: Long, val username: String, val name: String, val avatarUrl: String? = null,
    val bio: String = "", val phone: String = "", val online: Boolean = false
)
data class VolnaUpdate(val versionCode: Long, val versionName: String, val apkPath: String, val sha256: String)
data class VolnaChat(
    val id: Long,
    val name: String,
    val username: String,
    val lastText: String,
    val lastAt: String,
    val unread: Int,
    val saved: Boolean,
    val peerId: Long,
    val peerRead: Long = 0,
    val peerDelivered: Long = 0,
    val kind: String = "direct",
    val archived: Boolean = false,
    val muted: Boolean = false,
    val pinned: Boolean = false,
    val role: String = "member", val canSend: Boolean = true, val memberCount: Int = 0,
    val avatarUrl: String? = null, val lastId: Long = 0, val lastSenderId: Long = 0, val peerOnline: Boolean = false, val parentId: Long = 0, val topicClosed: Boolean = false
)
data class VolnaReaction(val emoji: String, val userId: Long, val name: String)
data class VolnaReply(val id: Long, val name: String, val text: String, val deleted: Boolean)
data class VolnaMessage(
    val id: Long,
    val senderId: Long,
    val senderName: String,
    val text: String,
    val createdAt: String,
    val deleted: Boolean,
    val attachmentName: String?,
    val attachmentId: String? = null,
    val attachmentMime: String? = null,
    val reply: VolnaReply? = null,
    val reactions: List<VolnaReaction> = emptyList(),
    val edited: Boolean = false,
    val pinned: Boolean = false,
    val transcript: String? = null,
    val forwardedName: String? = null,
    val attachmentSize: Long = 0, val albumId: String? = null, val chatId: Long = 0,
    val expressionKind: String? = null, val expressionId: String? = null,
    val emojiEntities: List<NativeEmojiEntity> = emptyList()
)
data class VolnaSession(val token: String, val user: VolnaUser, val refreshToken: String = "")
internal class NativeApiException(val status: Int, message: String, val errorCode: String = "", val retryAt: Long = 0, val serverTime: Long = 0) : IllegalStateException(message)

class NativeApi(baseUrl: String) {
    private val base = baseUrl.trimEnd('/')
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .addInterceptor { chain ->
            val original = chain.request()
            val supplied = original.header("Authorization")?.removePrefix("Bearer ")
            val request = original.newBuilder().header("User-Agent", "VolnaAndroid/${BuildConfig.VERSION_NAME}")
            if (!supplied.isNullOrBlank()) request.header("Authorization", "Bearer ${NativeCredentials.resolve(supplied)}")
            val first = chain.proceed(request.build())
            if (first.code != 401 || supplied.isNullOrBlank() || NativeCredentials.refresh(supplied) == null) first
            else {
                val updated = synchronized(NativeCredentials.refreshLock) {
                    val current = NativeCredentials.resolve(supplied)
                    if (current != request.build().header("Authorization")?.removePrefix("Bearer ")) current
                    else {
                        val refresh = NativeCredentials.refresh(supplied)
                        if (refresh == null) null else try {
                            val session = credentials(call("/auth/refresh", "POST", data = JSONObject().put("refresh_token", refresh)))
                            NativeCredentials.store(session); session.token
                        } catch (problem: NativeApiException) { if (problem.status == 401 || problem.status == 403) null else { first.close(); throw problem } } catch (problem: Exception) { first.close(); throw problem }
                    }
                }
                if (updated == null) first else { first.close(); chain.proceed(original.newBuilder().header("User-Agent", "VolnaAndroid/${BuildConfig.VERSION_NAME}").header("Authorization", "Bearer $updated").build()) }
            }
        }
        .build()
    private fun credentials(result: JSONObject) = VolnaSession(result.getString("token"), parseUser(result.getJSONObject("user")), result.getString("refresh_token"))
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun call(path: String, method: String = "GET", token: String? = null, data: JSONObject? = null): JSONObject {
        val builder = Request.Builder().url(base + "/api" + path).header("Accept", "application/json")
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        if (method == "POST") builder.post((data ?: JSONObject()).toString().toRequestBody(jsonType))
        if (method == "PATCH") builder.patch((data ?: JSONObject()).toString().toRequestBody(jsonType))
        if (method == "DELETE") builder.delete()
        val client = if (path.endsWith("/transcribe")) http.newBuilder().readTimeout(180, TimeUnit.SECONDS).build() else http
        val response = client.newCall(builder.build()).execute()
        response.use {
            val text = it.body?.string().orEmpty()
            val value = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
            if (!it.isSuccessful) throw NativeApiException(it.code, value.optString("error").ifBlank { "Ошибка сервера (${it.code})" }, value.optString("code"), value.optLong("retry_at"), value.optLong("server_time"))
            return value
        }
    }

    fun otpConfig(): JSONObject = call("/auth/config")
    fun otpStart(phone: String, requestId: String, appHash: String): JSONObject = call("/v1/auth/otp/start", "POST", data = JSONObject().put("phone_e164",phone).put("platform","android").put("locale","ru").put("request_id",requestId).put("app_hash",appHash))
    fun otpResend(id: String, requestId: String): JSONObject = call("/v1/auth/otp/resend", "POST", data = JSONObject().put("challenge_id",id).put("request_id",requestId))
    fun otpStatus(id: String): JSONObject = call("/v1/auth/otp/status", "POST", data = JSONObject().put("challenge_id",id))
    fun otpCancel(id: String) { call("/v1/auth/otp/cancel", "POST", data = JSONObject().put("challenge_id",id)) }
    fun otpVerify(id: String, code: String): VolnaSession = credentials(call("/v1/auth/otp/verify", "POST", data = JSONObject().put("challenge_id",id).put("code",code)))
    fun smsRequest(phone: String): JSONObject = call("/auth/sms/request", "POST", data = JSONObject().put("phone", phone))
    fun smsVerify(id: String, code: String): VolnaSession = credentials(call("/auth/sms/verify", "POST", data = JSONObject().put("sms_session_id", id).put("code", code)))
    fun qrScan(token: String, qr: String): JSONObject = call("/auth/qr/scan", "POST", token, JSONObject().put("qr_text", qr))
    fun qrConfirm(token: String, qr: String, approve: Boolean) { call("/auth/qr/confirm", "POST", token, JSONObject().put("qr_text", qr).put("approve", approve)) }

    fun me(token: String): VolnaUser = parseUser(call("/me", token = token))

    fun userProfile(token: String, userId: Long): VolnaUser = parseUser(call("/users/$userId", token = token))

    fun updateProfile(token: String, name: String, bio: String, changeAvatar: Boolean = false, avatarId: String? = null, hideAvatar: Boolean = false): VolnaUser {
        val data = JSONObject().put("name", name).put("bio", bio)
        if (changeAvatar) data.put("avatar_id", avatarId ?: JSONObject.NULL).put("avatar_hidden", hideAvatar)
        return parseUser(call("/profile", "POST", token, data))
    }

    fun discardAttachment(token: String, id: String) { call("/uploads/$id/discard", "POST", token) }

    fun checkUpdate(currentVersionCode: Long): VolnaUpdate? {
        val request = Request.Builder()
            .url("$base/download/volna-android-version.json?check=${System.currentTimeMillis()}")
            .header("Accept", "application/json")
            .header("Cache-Control", "no-cache")
            .build()
        http.newCall(request).execute().use { response ->
            val expectedOrigin = URI(base)
            val finalUrl = URI(response.request.url.toString())
            if (finalUrl.scheme != "https" || finalUrl.host != expectedOrigin.host || finalUrl.port != expectedOrigin.port) {
                throw IllegalStateException("Сервер проверки обновлений перенаправил запрос на другой адрес")
            }
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            val row = JSONObject(body)
            val code = row.optLong("version_code")
            val name = row.optString("version_name")
            val path = row.optString("apk_path")
            val hash = row.optString("sha256").lowercase()
            if (code <= currentVersionCode) return null
            if (code <= 0 || name.isBlank() || !path.matches(Regex("/download/[A-Za-z0-9._-]+\\.apk")) || !hash.matches(Regex("[a-f0-9]{64}"))) {
                throw IllegalStateException("На сервере опубликовано некорректное описание обновления")
            }
            return VolnaUpdate(code, name, path, hash)
        }
    }

    fun downloadUpdate(update: VolnaUpdate, destination: File) {
        try {
            val request = Request.Builder().url(base + update.apkPath).header("Accept", "application/vnd.android.package-archive").build()
            http.newCall(request).execute().use { response ->
                val expectedOrigin = URI(base)
                val finalUrl = URI(response.request.url.toString())
                if (finalUrl.scheme != "https" || finalUrl.host != expectedOrigin.host || finalUrl.port != expectedOrigin.port) {
                    throw IllegalStateException("Сервер перенаправил обновление на другой адрес")
                }
                if (!response.isSuccessful) throw IllegalStateException("Не удалось скачать обновление (${response.code})")
                val body = response.body ?: throw IllegalStateException("Сервер вернул пустой APK")
                if (body.contentLength() > 120L * 1024 * 1024) throw IllegalStateException("Размер APK превышает допустимый")
                destination.parentFile?.mkdirs()
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                body.byteStream().use { input -> FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > 120L * 1024 * 1024) throw IllegalStateException("Размер APK превышает допустимый")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                    output.fd.sync()
                } }
                val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
                if (total == 0L || actual != update.sha256) throw IllegalStateException("Контрольная сумма обновления не совпала")
            }
        } catch (problem: Exception) {
            destination.delete()
            throw problem
        }
    }

    fun checkUsername(token: String, username: String): JSONObject = call("/users/username/check?username=" + android.net.Uri.encode(username), token = token)
    fun changeUsername(token: String, username: String): VolnaUser = parseUser(call("/users/me/username", "PATCH", token, JSONObject().put("username", username)).getJSONObject("user"))
    fun publicProfile(username: String): VolnaUser = parseUser(call("/public/users/" + android.net.Uri.encode(username)))
    fun topics(token: String, group: Long): JSONObject = call("/groups/$group/topics", token = token)
    fun topicAction(token: String, group: Long, path: String, data: JSONObject = JSONObject(), method: String = "POST"): JSONObject = call("/groups/$group/topics$path", method, token, data)

    fun logout(token: String) { call("/logout", "POST", token) }

    fun chats(token: String): List<VolnaChat> {
        val request = Request.Builder().url("$base/api/chats").header("Authorization", "Bearer $token").build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            val rows = JSONArray(body)
            return (0 until rows.length()).map { index ->
                val row = rows.getJSONObject(index)
                VolnaChat(row.optLong("id"), row.optString("name", "Чат"), row.optString("username"),
                    (if (row.isNull("last_text")) "" else row.optString("last_text")), (if (row.isNull("last_at")) "" else row.optString("last_at")), row.optInt("unread"),
                    row.optInt("saved") == 1, row.optLong("peer_id"), row.optLong("peer_read"), row.optLong("peer_delivered", row.optLong("peer_read")),
                    row.optString("kind", "direct"), row.optInt("archived") == 1, row.optInt("muted") == 1, row.optInt("pinned") == 1,
                    row.optString("role", "member"), row.optInt("can_send", 1) == 1, row.optInt("member_count"), nullableText(row, "avatar_url"), row.optLong("last_id"), row.optLong("last_sender_id"), row.optBoolean("peer_online"), row.optLong("parent_id"), row.optInt("topic_closed")==1)
            }
        }
    }

    fun messages(token: String, chatId: Long, before: Long? = null): List<VolnaMessage> {
        val request = Request.Builder().url("$base/api/chats/$chatId/messages" + if (before != null) "?before=$before" else "")
            .header("Authorization", "Bearer $token").build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            val rows = JSONArray(body)
            return (0 until rows.length()).map { index ->
                val row = rows.getJSONObject(index)
                parseMessage(row)
            }
        }
    }

    fun searchMessages(token: String, chatId: Long, query: String): List<VolnaMessage> =
        messageList(token, "/chats/$chatId/search?q=" + java.net.URLEncoder.encode(query, "UTF-8"))

    fun pinnedMessages(token: String, chatId: Long): List<VolnaMessage> = messageList(token, "/chats/$chatId/pins")
    fun searchAllMessages(token: String, query: String): List<VolnaMessage> = messageList(token, "/search/messages?q=" + java.net.URLEncoder.encode(query, "UTF-8"))
    fun message(token: String, id: Long): VolnaMessage = parseMessage(call("/messages/$id", token = token))
    fun messagesAround(token: String, chatId: Long, id: Long): List<VolnaMessage> = messageList(token, "/chats/$chatId/messages?around=$id")

    private fun messageList(token: String, path: String): List<VolnaMessage> {
        val request = Request.Builder().url("$base/api$path").header("Authorization", "Bearer $token").build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            val rows = JSONArray(body)
            return (0 until rows.length()).map { parseMessage(rows.getJSONObject(it)) }
        }
    }

    fun send(token: String, chatId: Long, text: String, replyTo: Long? = null, attachmentId: String? = null, clientId: String = UUID.randomUUID().toString().replace("-", ""), emojiEntities: List<NativeEmojiEntity> = emptyList(), expressionId: String? = null): VolnaMessage {
        val body = JSONObject().put("text", text).put("client_id", clientId)
        if (replyTo != null) body.put("reply_to", replyTo)
        if (attachmentId != null) body.put("attachment_id", attachmentId)
        if (expressionId != null) body.put("expression_id", expressionId)
        if (emojiEntities.isNotEmpty()) body.put("emoji_entities", JSONArray(emojiEntities.map { it.json() }))
        val result = call("/chats/$chatId/messages", "POST", token,
            body)
        return parseMessage(result)
    }

    fun sendAlbum(token: String, chatId: Long, attachmentIds: List<String>, text: String, replyTo: Long?, clientId: String): List<VolnaMessage> {
        require(attachmentIds.size in 2..10) { "Альбом: от 2 до 10 фото или видео" }
        val body = JSONObject().put("attachment_ids", JSONArray(attachmentIds)).put("text", text).put("client_id", clientId)
        if (replyTo != null) body.put("reply_to", replyTo)
        val request = Request.Builder().url("$base/api/chats/$chatId/album").header("Authorization", "Bearer $token")
            .header("Accept", "application/json").post(body.toString().toRequestBody(jsonType)).build()
        http.newCall(request).execute().use { response ->
            val textBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(textBody, response.code)
            val rows = JSONArray(textBody)
            return (0 until rows.length()).map { parseMessage(rows.getJSONObject(it)) }
        }
    }

    fun updateMessage(token: String, id: Long, text: String) = parseMessage(call("/messages/$id/edit", "POST", token, JSONObject().put("text", text)))
    fun updateRichMessage(token: String, id: Long, text: String, entities: List<NativeEmojiEntity>) = parseMessage(call("/messages/$id/edit", "POST", token, JSONObject().put("text", text).put("emoji_entities", JSONArray(entities.map { it.json() }))))
    internal fun expressionPacks(token: String, query: String = ""): List<NativeExpressionPack> = arrayCall("/expressions/packs?q=" + java.net.URLEncoder.encode(query, "UTF-8"), token).let { rows -> (0 until rows.length()).map { NativeExpressionPack.parse(rows.getJSONObject(it)) } }
    internal fun expressionPack(token: String, id: String): NativeExpressionPack = NativeExpressionPack.parse(call("/expressions/packs/$id", token = token))
    internal fun expressions(token: String, kind: String, section: String, query: String, offset: Int = 0): NativeExpressionPage {
        val value = call("/expressions?kind=$kind&section=$section&q=${java.net.URLEncoder.encode(query, "UTF-8")}&offset=$offset", token = token)
        return NativeExpressionPage(NativeExpression.parseList(value.optJSONArray("items")), value.optBoolean("more"), value.optInt("next_offset"))
    }
    internal fun installExpressionPack(token: String, id: String, install: Boolean) { call("/expressions/packs/$id/" + if (install) "install" else "remove", "POST", token) }
    internal fun favoriteExpression(token: String, id: String, active: Boolean) { call("/expressions/$id/favorite", "POST", token, JSONObject().put("active", active)) }
    internal fun createExpressionPack(token: String, title: String, kind: String, isPublic: Boolean, items: List<JSONObject>, clientId: String): NativeExpressionPack = NativeExpressionPack.parse(call("/expressions/packs", "POST", token, JSONObject().put("title", title).put("kind", kind).put("public", isPublic).put("items", JSONArray(items)).put("client_id", clientId)))
    fun deleteMessage(token: String, id: Long) = parseMessage(call("/messages/$id/delete", "POST", token))
    fun react(token: String, id: Long, emoji: String, active: Boolean) = parseMessage(call("/messages/$id/react", "POST", token, JSONObject().put("emoji", emoji).put("active", active)))
    fun pin(token: String, id: Long, pinned: Boolean) = parseMessage(call("/messages/$id/pin", "POST", token, JSONObject().put("pinned", pinned)))
    fun forward(token: String, messageId: Long, chatId: Long, clientId: String = UUID.randomUUID().toString().replace("-", "")): VolnaMessage = parseMessage(call("/messages/$messageId/forward", "POST", token,
        JSONObject().put("chat_id", chatId).put("client_id", clientId)))
    fun transcribe(token: String, id: Long): String = call("/messages/$id/transcribe", "POST", token).optString("transcript")

    fun upload(token: String, fileName: String, mime: String, bytes: ByteArray): String {
        val request = Request.Builder().url("$base/api/uploads").header("Authorization", "Bearer $token")
            .header("X-File-Name", java.net.URLEncoder.encode(fileName, "UTF-8").replace("+", "%20"))
            .header("Content-Type", mime).post(bytes.toRequestBody(mime.toMediaTypeOrNull())).build()
        http.newCall(request).execute().use { response ->
            val value = JSONObject(response.body?.string().orEmpty())
            if (!response.isSuccessful) throw IllegalStateException(value.optString("error").ifBlank { "Ошибка загрузки (${response.code})" })
            return value.getString("id")
        }
    }

    fun attachmentUrl(fileId: String) = "$base/api/files/$fileId"

    fun downloadAttachment(token: String, fileId: String, destination: File) {
        require(fileId.matches(Regex("[a-f0-9]{48}"))) { "Некорректное вложение" }
        val partial = File(destination.parentFile, destination.name + ".part")
        destination.parentFile?.mkdirs()
        try {
            http.newCall(Request.Builder().url(attachmentUrl(fileId)).header("Authorization", "Bearer $token").build()).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Вложение недоступно (${response.code})")
                val body = response.body ?: throw IllegalStateException("Пустой ответ с вложением")
                if (body.contentLength() > 20L * 1024 * 1024) throw IllegalStateException("Максимальный размер вложения — 20 МБ")
                var bytes = 0L
                body.byteStream().use { input -> FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        bytes += count
                        if (bytes > 20L * 1024 * 1024) throw IllegalStateException("Максимальный размер вложения — 20 МБ")
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                } }
                if (bytes == 0L) throw IllegalStateException("Файл пуст")
                if (!partial.renameTo(destination)) throw IllegalStateException("Не удалось сохранить вложение")
            }
        } catch (error: Exception) { partial.delete(); throw error }
    }

    fun gallery(token: String, chatId: Long, before: Long? = null, type: String = "all"): List<VolnaMessage> = messageList(token, "/chats/$chatId/media?type=$type" + if (before != null) "&before=$before" else "")
    fun contacts(token: String): List<VolnaUser> = arrayCall("/contacts", token).let { rows -> (0 until rows.length()).map { parseUser(rows.getJSONObject(it)) } }
    fun callHistory(token: String, before: Long? = null): List<VolnaCallRecord> = arrayCall("/calls/history" + if (before != null) "?before=$before" else "", token).let { rows ->
        (0 until rows.length()).map { i -> val row = rows.getJSONObject(i); VolnaCallRecord(row.getString("id"), row.getLong("chat_id"), row.optJSONObject("peer")?.let(::parseUser), row.optBoolean("incoming"), row.getLong("created"), row.optString("status"), row.optInt("duration"), row.optBoolean("screen_shared"), row.optBoolean("video")) }
    }
    fun sessions(token: String): List<VolnaDeviceSession> = arrayCall("/sessions", token).let { rows ->
        (0 until rows.length()).map { i -> val row = rows.getJSONObject(i); VolnaDeviceSession(row.getString("id"), row.optString("label"), row.optBoolean("current"), row.optLong("last_seen"), row.getLong("expires")) }
    }
    fun revokeSession(token: String, id: String) { require(id == "others" || id.matches(Regex("[a-f0-9]{64}"))); call("/sessions/$id/revoke", "POST", token) }
    private fun arrayCall(path: String, token: String): JSONArray {
        http.newCall(Request.Builder().url("$base/api$path").header("Authorization", "Bearer $token").build()).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            return JSONArray(body)
        }
    }

    fun savedChat(token: String): Long = call("/saved", "POST", token).getLong("id")

    fun createCommunity(token: String, kind: String, title: String, description: String, clientId: String): Long =
        call("/communities", "POST", token, JSONObject().put("kind", kind).put("title", title).put("description", description).put("client_id", clientId)).getLong("id")

    fun joinCommunity(token: String, invite: String): Long = call("/invites/join", "POST", token, JSONObject().put("token", invite.trim())).getLong("id")

    fun community(token: String, chatId: Long): VolnaCommunity = parseCommunity(call("/communities/$chatId", token = token))

    fun communityAction(token: String, chatId: Long, action: String, userId: Long? = null, role: String? = null, title: String? = null, description: String? = null, postingPolicy: String? = null): JSONObject {
        val data = JSONObject()
        if (userId != null) data.put("user_id", userId)
        if (role != null) data.put("role", role)
        if (title != null) data.put("title", title)
        if (description != null) data.put("description", description)
        if (postingPolicy != null) data.put("posting_policy", postingPolicy)
        return call("/communities/$chatId/$action", "POST", token, data)
    }

    fun callConfig(token: String): JSONObject = call("/calls/config", token = token)
    fun callScreen(token: String, device: String, id: String, sharing: Boolean) { call("/calls/$id/screen", "POST", token, JSONObject().put("device", device).put("sharing", sharing)) }
    fun callCamera(token: String, device: String, id: String, enabled: Boolean) { call("/calls/$id/camera", "POST", token, JSONObject().put("device", device).put("enabled", enabled)) }

    fun currentCall(token: String, device: String): VolnaCall? {
        val request = Request.Builder().url("$base/api/calls/current?device=$device").header("Authorization", "Bearer $token").build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(text, response.code)
            return if (text.trim() == "null") null else parseCall(JSONObject(text))
        }
    }

    fun startCall(token: String, device: String, chatId: Long, video: Boolean = false): VolnaCall =
        parseCall(call("/calls/start", "POST", token, JSONObject().put("device", device).put("chat_id", chatId).put("video", video)))

    fun callAction(token: String, device: String, id: String, action: String, description: JSONObject? = null): VolnaCall? {
        val data = JSONObject().put("device", device)
        if (description != null) data.put("description", description)
        val result = call("/calls/$id/$action", "POST", token, data)
        return if (action == "end") null else parseCall(result)
    }

    private fun parseCall(row: JSONObject) = VolnaCall(row.getString("id"), row.optLong("chat_id"), row.optJSONObject("peer")?.let(::parseUser), row.optBoolean("incoming"), row.getString("status"), row.optJSONObject("offer"), row.optJSONObject("answer"), if (row.has("peer_sharing")) row.optBoolean("peer_sharing") else null, row.optBoolean("video"), row.optBoolean("peer_video"))

    private fun parseCommunity(row: JSONObject): VolnaCommunity {
        fun users(name: String): List<VolnaMember> {
            val values = row.optJSONArray(name) ?: return emptyList()
            return (0 until values.length()).map { i -> values.getJSONObject(i).let { VolnaMember(it.getLong("id"), it.optString("name"), it.optString("username"), it.optString("role", "member")) } }
        }
        return VolnaCommunity(row.getLong("id"), row.optString("kind"), row.optString("title"), row.optString("description"), row.optString("role"), row.optInt("member_count"), users("members"), users("banned"), row.optJSONObject("invite"), row.optString("posting_policy", "all"))
    }

    fun searchPeople(token: String, query: String): List<VolnaUser> {
        val url = "$base/api/users?q=" + java.net.URLEncoder.encode(query, "UTF-8")
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw apiError(body, response.code)
            val rows = JSONArray(body)
            return (0 until rows.length()).map { index -> parseUser(rows.getJSONObject(index)) }
        }
    }

    fun startChat(token: String, userId: Long): Long = call("/chats", "POST", token, JSONObject().put("user_id", userId)).getLong("id")

    fun updateChatPreference(token: String, chatId: Long, preference: String, value: Boolean) {
        call("/chats/$chatId/preferences", "POST", token, JSONObject().put(preference, value))
    }

    fun markRead(token: String, chatId: Long, messageId: Long) {
        call("/chats/$chatId/read", "POST", token, JSONObject().put("message_id", messageId))
    }

    fun markDelivered(token: String, chatId: Long, messageId: Long) {
        call("/chats/$chatId/delivered", "POST", token, JSONObject().put("message_id", messageId))
    }

    internal fun contactRequest(path: String, token: String, data: JSONObject? = null): JSONObject = call(path, if (data == null) "GET" else "POST", token, data)
    internal fun contactUser(row: JSONObject): VolnaUser = parseUser(row)

    private fun parseUser(row: JSONObject): VolnaUser {
        return VolnaUser(
            id = row.optLong("id"), username = row.optString("username"), name = row.optString("name", row.optString("username")),
            avatarUrl = row.optString("avatar_url").takeIf { it.isNotBlank() && it != "null" },
            bio = row.optString("bio"), phone = nullableText(row,"phone").orEmpty(), online = row.optBoolean("online")
        )
    }

    internal fun parseMessage(row: JSONObject): VolnaMessage {
        val file = row.optJSONObject("attachment")
        val replyJson = row.optJSONObject("reply")
        val reply = replyJson?.let { VolnaReply(it.optLong("id"), it.optString("name", ""), it.optString("text", ""), it.optBoolean("deleted")) }
        val reactionsJson = row.optJSONArray("reactions")
        val reactions = if (reactionsJson == null) emptyList() else (0 until reactionsJson.length()).map { i ->
            val reaction = reactionsJson.getJSONObject(i); VolnaReaction(reaction.optString("emoji"), reaction.optLong("user_id"), reaction.optString("name"))
        }
        val deletedAt = if (row.isNull("deleted_at")) null else row.optString("deleted_at").takeUnless { it.isBlank() || it == "null" }
        return VolnaMessage(row.optLong("id"), row.optLong("sender_id"), row.optString("sender_name", ""),
            row.optString("text"), row.optString("created_at"), deletedAt != null,
            file?.optString("name")?.takeIf { !it.isNullOrBlank() && it != "null" },
            file?.optString("id")?.takeIf { !it.isNullOrBlank() && it != "null" },
            file?.optString("mime")?.takeIf { !it.isNullOrBlank() && it != "null" }, reply, reactions,
            !row.isNull("edited_at") && row.optString("edited_at").isNotBlank() && row.optString("edited_at") != "null",
            row.optBoolean("pinned"), row.optString("transcript").takeIf { it.isNotBlank() && it != "null" },
            row.optString("forwarded_name").takeIf { it.isNotBlank() && it != "null" }, file?.optLong("size") ?: 0L, nullableText(row, "album_id"), row.optLong("chat_id"), row.optJSONObject("expression")?.optString("kind"), nullableText(row, "expression_id"),
            row.optJSONArray("emoji_entities")?.let { values -> (0 until values.length()).map { NativeEmojiEntity.parse(values.getJSONObject(it)) } } ?: emptyList())
    }
    private fun nullableText(row: JSONObject, key: String): String? = row.optString(key).takeIf { it.isNotBlank() && it != "null" }
    private fun apiError(body: String, code: Int): Exception = try {
        NativeApiException(code, JSONObject(body).optString("error").ifBlank { "Ошибка сервера ($code)" })
    } catch (_: Exception) { NativeApiException(code, "Ошибка сервера ($code)") }
}

data class VolnaMember(val id: Long, val name: String, val username: String, val role: String)
data class VolnaCommunity(val id: Long, val kind: String, val title: String, val description: String, val role: String, val memberCount: Int, val members: List<VolnaMember>, val banned: List<VolnaMember>, val invite: JSONObject?, val postingPolicy: String = "all") {
    val canManage: Boolean get() = role == "owner" || role == "admin"
}
data class VolnaCall(val id: String, val chatId: Long, val peer: VolnaUser?, val incoming: Boolean, val status: String, val offer: JSONObject?, val answer: JSONObject?, val peerSharing: Boolean? = null, val video: Boolean = false, val peerVideo: Boolean = false)
data class VolnaCallRecord(val id: String, val chatId: Long, val peer: VolnaUser?, val incoming: Boolean, val created: Long, val status: String, val duration: Int, val screenShared: Boolean, val video: Boolean = false)
data class VolnaDeviceSession(val id: String, val label: String, val current: Boolean, val lastSeen: Long, val expires: Long)
