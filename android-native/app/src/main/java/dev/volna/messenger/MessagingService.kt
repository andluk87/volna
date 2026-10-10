package dev.volna.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.flow.MutableSharedFlow

internal data class NativeSessionSignal(val account: Long,val type: String,val chatId: Long,val userId: Long)

internal data class NativeMessagingEvent(val account: Long, val type: String, val message: VolnaMessage)

/** Keeps the authenticated Volna event stream alive while the app is minimized. */
class MessagingService : Service() {
    private val prefs by lazy { getSharedPreferences("volna-native", Context.MODE_PRIVATE) }
    @Volatile private var stopped = false
    @Volatile private var streamCall: okhttp3.Call? = null
    private var worker: Thread? = null
    @Volatile private var generation = 0
    @Volatile private var activeToken = ""
    private val cache by lazy { NativeCache(this) }
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL) }
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true).build()
    }

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            NativeCalls.configure(this, "")
            stopped = true
            streamCall?.cancel()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val token = intent?.getStringExtra(EXTRA_TOKEN)?.takeIf { it.isNotBlank() }
            ?: NativeCredentials.access(prefs.getLong("user_id",0))
        val userId = intent?.getLongExtra(EXTRA_USER_ID, 0L)?.takeIf { it > 0 }
            ?: prefs.getLong("user_id", 0L)
        if (token.isBlank()) {
            NativeCalls.configure(this, "")
            stopSelf()
            return START_NOT_STICKY
        }
        if (activeToken != token) { generation++; streamCall?.cancel(); worker?.interrupt(); worker = null; activeToken = token }
        prefs.edit().remove("token").putLong("user_id", userId).apply()
        startForeground(FOREGROUND_ID, serviceNotification())
        NativeCalls.configure(this, token)
        if (worker?.isAlive != true) {
            stopped = false
            val version = generation
            worker = thread(name = "volna-events", isDaemon = true) { consume(token, userId, version) }
        }
        return START_STICKY
    }

    private fun consume(token: String, userId: Long, version: Int) {
        val url = BuildConfig.API_BASE_URL.trimEnd('/') + "/api/events"
        while (!stopped && version == generation) {
            try {
                val request = Request.Builder().url(url).header("Accept", "text/event-stream")
                    .header("Authorization", "Bearer ${NativeCredentials.resolve(token)}").build()
                val call = client.newCall(request)
                streamCall = call
                call.execute().use { response ->
                    if (stopped || version != generation || activeToken != token) return@use
                    if (!response.isSuccessful) {
                        if (response.code == 401 && NativeCredentials.refresh(token) != null) {
                            response.close()
                            try { api.me(token); return@use } catch (problem: NativeApiException) {
                                if (problem.status == 401 || problem.status == 403) { NativeCredentials.remove(userId); stopped = true; Handler(Looper.getMainLooper()).post { NativeCalls.configure(this, "") }; stopSelf() }; return@use
                            } catch (_: Exception) {
                                // Retry transient connectivity failures without discarding credentials.
                                Thread.sleep(1800); return@use
                            }
                        }
                        if (response.code == 401 || response.code == 403) {
                            prefs.edit().remove("token").remove("user_id").apply()
                            Handler(Looper.getMainLooper()).post { NativeCalls.configure(this, "") }
                            stopped = true
                            stopSelf()
                            return@use
                        }
                        throw IllegalStateException("events ${response.code}")
                    }
                    val source = response.body?.source() ?: return@use
                    var eventData = StringBuilder()
                    while (!stopped && version == generation && !source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        if (line.startsWith("data:")) eventData.append(line.removePrefix("data:").trim())
                        if (line.isEmpty() && eventData.isNotEmpty()) {
                            if (version == generation) handleEvent(eventData.toString(), userId)
                            eventData = StringBuilder()
                        }
                    }
                }
            } catch (_: Exception) {
                if (!stopped && version == generation) try { Thread.sleep(1800) } catch (_: InterruptedException) { break }
            }
        }
    }

    private fun handleEvent(raw: String, userId: Long) {
        try {
            val event = JSONObject(raw)
            val type = event.optString("type")
            if (type in listOf("profile","topics","community","removed","chats")) { if(type=="profile" && event.optLong("user_id")==userId) runCatching { val user=api.me(activeToken);NativeAccounts.remember(this,user,activeToken);cache.saveMe(user) };signals.tryEmit(NativeSessionSignal(userId,type,event.optLong("chat_id"),event.optLong("user_id")));return }
            if (type !in listOf("message", "message-update")) return
            val message = event.optJSONObject("message") ?: return
            val chatId = message.optLong("chat_id")
            val parsed = api.parseMessage(message)
            runCatching { val existing = cache.messages(userId, chatId); cache.saveMessages(userId, chatId, (existing.filter { it.id != parsed.id } + parsed).sortedBy { it.id }) }
            events.tryEmit(NativeMessagingEvent(userId, type, parsed))
            if (!event.optBoolean("notify", true) || !message.isNull("deleted_at")) return
            val settings = NativeNotificationPolicy.prefs(this, userId)
            if (chatId.toString() in settings.getStringSet("mutedChats", emptySet()).orEmpty()) return
            val reaction = event.optJSONObject("reaction")
            val sender = message.optLong("sender_id")
            val replyToMe = message.optJSONObject("reply")?.optLong("sender_id") == userId
            val username = NativeAccounts.list(this).firstOrNull { it.user.id == userId }?.user?.username.orEmpty()
            val mentioned = username.isNotBlank() && Regex("(?i)(?<![a-z0-9_])@" + Regex.escape(username) + "(?![a-z0-9_])").containsMatchIn(message.optString("text"))
            val isReaction = type == "message-update" && reaction?.optBoolean("active") == true && reaction.optLong("user_id") != userId && sender == userId
            if (isReaction) { if (!settings.getBoolean("reactions", true)) return }
            else {
                if (type != "message" || sender == userId) return
                val allowed = if (replyToMe) settings.getBoolean("replies", true) else if (mentioned) settings.getBoolean("mentions", true) else settings.getBoolean("messages", true)
                if (!allowed) return
            }
            if (MainActivity.isVisible && MainActivity.visibleChatId == chatId) return
            val id = message.optLong("id")
            val title = if (isReaction) "Новая реакция" else if(!message.isNull("topic_id")) "${message.optString("group_name")} › ${message.optString("topic_name")}" else message.optString("sender_name", "Волна").ifBlank { "Волна" }
            val preview = if (isReaction) "${reaction?.optString("emoji")} на ваше сообщение" else message.optString("text").ifBlank { message.optJSONObject("attachment")?.optString("name") ?: "Вложение" }
            val body = if (settings.getBoolean("preview", true)) preview else if (isReaction) "Реакция на сообщение" else "Новое сообщение"
            val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            launch.putExtra("chat_id", chatId).putExtra("message_id", id).putExtra("account_id", userId)
            val notificationId = ((id xor (id ushr 32)).toInt() and 0x1fffffff) + if (isReaction) 0x20000000 else 0
            val pending = PendingIntent.getActivity(this, notificationId, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val channel = NativeNotificationSounds.messageChannel(this, userId)
            val notification = builder(title, body, channel).setContentIntent(pending).setAutoCancel(true)
                .setGroup("volna-messages-$userId").setOnlyAlertOnce(false).build()
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(notificationId, notification)
        } catch (_: Exception) { }
    }

    private fun serviceNotification(): Notification = builder("Волна", "Связь с сообщениями активна", STATUS_CHANNEL)
        .setOngoing(true).setOnlyAlertOnce(true).build()

    private fun builder(title: String, text: String, channel: String): Notification.Builder {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notification = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
        return notification.setSmallIcon(R.drawable.ic_volna).setContentTitle(title).setContentText(text)
            .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(pending).setShowWhen(true)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Сообщения Волны", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
            manager.createNotificationChannel(NotificationChannel(SILENT_CHANNEL, "Сообщения без звука", NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(null, null); enableVibration(false) })
            manager.createNotificationChannel(NotificationChannel(STATUS_CHANNEL, "Связь", NotificationManager.IMPORTANCE_LOW))
        }
    }

    override fun onDestroy() {
        stopped = true
        generation++
        streamCall?.cancel()
        worker?.interrupt()
        client.dispatcher.cancelAll()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        internal val signals = MutableSharedFlow<NativeSessionSignal>(extraBufferCapacity = 64)
        internal val events = MutableSharedFlow<NativeMessagingEvent>(extraBufferCapacity = 64)
        const val ACTION_STOP = "dev.volna.messenger.STOP_MESSAGING"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_USER_ID = "user_id"
        internal const val SILENT_CHANNEL = "volna_messages_silent"
        internal const val CHANNEL_ID = "volna_messages"
        private const val STATUS_CHANNEL = "volna_connection"
        private const val FOREGROUND_ID = 11022

        fun start(context: Context, token: String, userId: Long) {
            val intent = Intent(context, MessagingService::class.java)
                .putExtra(EXTRA_TOKEN, token).putExtra(EXTRA_USER_ID, userId)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun stop(context: Context) {
            NativeCalls.configure(context, "")
            context.stopService(Intent(context, MessagingService::class.java))
        }
    }
}
