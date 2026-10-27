package dev.volna.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.util.concurrent.ConcurrentHashMap
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.flow.MutableSharedFlow

internal data class NativeSessionSignal(val account: Long,val type: String,val chatId: Long,val userId: Long,val deleted: Boolean = false)

internal data class NativeMessagingEvent(val account: Long, val type: String, val message: VolnaMessage)

/** Keeps the authenticated Volna event stream alive while the app is minimized. */
class MessagingService : Service() {
    private val prefs by lazy { getSharedPreferences("volna-native", Context.MODE_PRIVATE) }
    @Volatile private var stopped = false
    private class AccountStream(val userId: Long, val token: String) {
        @Volatile var stopped = false
        @Volatile var call: okhttp3.Call? = null
        var worker: Thread? = null
        var callsWorker: Thread? = null
        var receiptsWorker: Thread? = null
        val receipts = NativeDeliveryQueue()
        @Volatile var receiptSyncVersion = 0
        fun stop() { stopped = true; call?.cancel(); worker?.interrupt(); callsWorker?.interrupt(); receiptsWorker?.interrupt() }
    }
    private val notificationScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val avatarLoads=Semaphore(2)
    private val artworkGeneration=java.util.concurrent.atomic.AtomicLong()
    private val streams = ConcurrentHashMap<Long, AccountStream>()
    private val priorityRingtones = ConcurrentHashMap<Long, android.media.Ringtone>()
    private val main = Handler(Looper.getMainLooper())
    private val reconcile = object : Runnable {
        override fun run() { if (!stopped) { syncAccounts(); main.postDelayed(this, 6_000) } }
    }
    private val cache by lazy { NativeCache(this) }
    private val api by lazy { NativeApi(BuildConfig.API_BASE_URL) }
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true).build()
    }

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        NativeIdleUpdater.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            NativeCalls.configure(this, ""); stopped = true
            priorityRingtones.keys.toList().forEach { clearBackgroundCall(it) }
            streams.values.forEach { it.stop() }; streams.clear()
            main.removeCallbacks(reconcile); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
            return START_NOT_STICKY
        }
        stopped = false
        val selectedId = intent?.getLongExtra(EXTRA_USER_ID, 0L)?.takeIf { it > 0 } ?: prefs.getLong("user_id", 0L)
        val selectedToken = intent?.getStringExtra(EXTRA_TOKEN)?.takeIf { it.isNotBlank() } ?: NativeCredentials.access(selectedId)
        if (intent?.action == ACTION_SYNC) NativeCalls.configure(this, "")
        else if (selectedToken.isNotBlank()) { prefs.edit().remove("token").putLong("user_id", selectedId).apply(); NativeCalls.configure(this, selectedToken) }
        startForeground(FOREGROUND_ID, serviceNotification())
        syncAccounts()
        main.removeCallbacks(reconcile); if (!stopped) main.postDelayed(reconcile, 6_000)
        return if (stopped) START_NOT_STICKY else START_STICKY
    }

    private fun syncAccounts() {
        val accounts = NativeAccounts.list(this).associateBy { it.user.id }
        val obsolete = nativeStreamsToStop(accounts.mapValues { it.value.token },streams.mapValues { it.value.token })
        streams.entries.toList().forEach { (id, stream) ->
            if (id in obsolete || stream.worker?.isAlive != true) { streams.remove(id, stream); stream.stop(); clearBackgroundCall(id) }
        }
        accounts.values.forEach { account ->
            if (!streams.containsKey(account.user.id)) {
                val stream = AccountStream(account.user.id, account.token)
                streams[account.user.id] = stream
                stream.worker = thread(name = "volna-events-${account.user.id}", isDaemon = true) { consume(stream) }
                stream.receiptsWorker = thread(name = "vln-receipts-${account.user.id}", isDaemon = true) { deliverReceipts(stream) }
                stream.callsWorker = thread(name = "volna-call-alerts-${account.user.id}", isDaemon = true) { watchCalls(stream) }
            }
        }
        if (accounts.isEmpty()) { stopped = true; NativeCalls.configure(this, ""); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }
    private fun current(stream: AccountStream) = !stopped && !stream.stopped && streams[stream.userId] === stream
    private fun invalidSession(stream: AccountStream) {
        if (!current(stream)) return
        NativeAccounts.remove(this, stream.userId)
        stream.stop(); streams.remove(stream.userId, stream); clearBackgroundCall(stream.userId)
        main.post {
            if (prefs.getLong("user_id", 0L) == stream.userId) { prefs.edit().remove("user_id").apply(); NativeCalls.configure(this, "") }
            syncAccounts()
        }
    }
    private fun consume(stream: AccountStream) {
        val url = BuildConfig.API_BASE_URL.trimEnd('/') + "/api/events"
        while (current(stream)) {
            try {
                val request = Request.Builder().url(url).header("Accept", "text/event-stream")
                    .header("Authorization", "Bearer ${NativeCredentials.resolve(stream.token)}").build()
                val call = client.newCall(request); stream.call = call
                call.execute().use { response ->
                    if (!current(stream)) return@use
                    if (!response.isSuccessful) {
                        if (response.code == 401 && NativeCredentials.refresh(stream.token) != null) {
                            response.close()
                            try { api.me(stream.token); return@use } catch (problem: NativeApiException) {
                                if (problem.status == 401 || problem.status == 403) invalidSession(stream)
                                else throw problem
                                return@use
                            }
                        }
                        if (response.code == 401 || response.code == 403) { invalidSession(stream); return@use }
                        throw IllegalStateException("events ${response.code}")
                    }
                    val source = response.body?.source() ?: return@use
                    var eventData = StringBuilder()
                    while (current(stream) && !source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        if (line.startsWith("data:")) eventData.append(line.removePrefix("data:").trim())
                        if (line.isEmpty() && eventData.isNotEmpty()) {
                            if (current(stream)) handleEvent(eventData.toString(), stream.userId, stream.token)
                            eventData = StringBuilder()
                        }
                    }
                }
            } catch (_: Exception) {
                if (current(stream)) try { Thread.sleep(1800) } catch (_: InterruptedException) { break }
            }
        }
    }

    private fun deliverReceipts(stream: AccountStream) {
        var synced = -1
        while (current(stream)) {
            try {
                val syncVersion = stream.receiptSyncVersion
                if (syncVersion != synced) {
                    // Recover missed messages after a stream reconnect, independently of Activity/call UI.
                    val chats = api.chats(stream.token)
                    for (chat in chats.filter { it.unread > 0 }) {
                        if (!current(stream)) return
                        try {
                            val rows = api.messages(stream.token, chat.id)
                            val existing = cache.messages(stream.userId, chat.id)
                            cache.saveMessages(stream.userId, chat.id, (existing.filter { old -> rows.none { it.id == old.id } } + rows).distinctBy { it.id }.sortedBy { it.id }.takeLast(1000))
                            rows.filter { it.senderId != stream.userId }.maxOfOrNull { it.id }?.let { stream.receipts.received(chat.id, it) }
                        } catch (problem: NativeApiException) {
                            if (problem.status !in listOf(400, 403, 404)) throw problem
                        }
                    }
                    synced = syncVersion
                }
                for ((chat, message) in stream.receipts.snapshot()) {
                    if (!current(stream)) return
                    try {
                        api.markDelivered(stream.token, chat, message)
                        stream.receipts.acknowledged(chat, message)
                    } catch (problem: NativeApiException) {
                        // A removed chat must not prevent delivery receipts for other chats.
                        if (problem.status in listOf(400, 403, 404)) stream.receipts.acknowledged(chat, message)
                    } catch (_: Exception) { /* Retry this chat without losing other receipts. */ }
                }
            } catch (_: Exception) { /* Keep pending receipts for the next attempt. */ }
            try { Thread.sleep(1500) } catch (_: InterruptedException) { break }
        }
    }

    private fun clearBackgroundCall(account: Long) { priorityRingtones.remove(account)?.let { runCatching { it.stop() } }; getSystemService(NotificationManager::class.java).cancel("volna-call-account-$account", NativeCalls.CALL_NOTIFICATION); NativeBackgroundCalls.remove(account) }
    private fun watchCalls(stream: AccountStream) {
        var alerted: String? = null
        val device = prefs.getString("call_device",null)?.takeIf { it.matches(Regex("[a-f0-9]{32}")) } ?: "0".repeat(32)
        while(current(stream)) {
            try {
                if(NativeCalls.configuredFor(stream.token)) { clearBackgroundCall(stream.userId); alerted=null }
                else {
                    val call=api.currentCall(stream.token,device)
                    if(!current(stream)) break
                    if(call == null || !call.incoming || call.status != "ringing") { clearBackgroundCall(stream.userId);alerted=null }
                    else if(call.id != alerted) {
                        val account=NativeAccounts.list(this).firstOrNull { it.user.id == stream.userId } ?: break
                        clearBackgroundCall(stream.userId)
                        CallAlerts.show(this,call,stream.userId,account.user.name,background=true)
                        NativeBackgroundCalls.put(stream.userId,account.user.name,call)
                        main.post {
                            if (current(stream) && !NativeCalls.configuredFor(stream.token) &&
                                NativeBackgroundCalls.calls.value[stream.userId]?.call?.id == call.id) {
                                NativePriorityCalls.play(this, stream.userId, call)?.let { priorityRingtones[stream.userId] = it }
                            }
                        }
                        if(getSystemService(NotificationManager::class.java).areNotificationsEnabled())api.callAction(stream.token,device,call.id,"ringing")
                        alerted=call.id
                    }
                }
            } catch(problem: NativeApiException) { if(problem.status in listOf(401,403)) { invalidSession(stream); break } }
            catch(_:Exception) { }
            try { Thread.sleep(2_000) } catch(_:InterruptedException) { break }
        }
        if (streams[stream.userId] == null || streams[stream.userId] === stream) clearBackgroundCall(stream.userId)
    }

    private fun handleEvent(raw: String, userId: Long, token: String) {
        try {
            val event = JSONObject(raw)
            val type = event.optString("type")
            if (type == "ready") { streams[userId]?.let { it.receiptSyncVersion++ }; signals.tryEmit(NativeSessionSignal(userId, "connected", 0, 0)); return }
            if (type in listOf("read", "delivered")) { signals.tryEmit(NativeSessionSignal(userId, type, event.optLong("chat_id"), 0)); return }
            if (type in listOf("profile","topics","community","removed","chats","history-cleared")) { if(type=="profile" && event.optLong("user_id")==userId) runCatching { val user=api.me(token);NativeAccounts.remember(this,user,token);cache.saveMe(user) };signals.tryEmit(NativeSessionSignal(userId,type,event.optLong("chat_id"),event.optLong("user_id"),event.optBoolean("deleted")));return }
            if (type !in listOf("message", "message-update")) return
            val message = event.optJSONObject("message") ?: return
            val chatId = message.optLong("chat_id")
            val parsed = api.parseMessage(message)
            runCatching { val existing = cache.messages(userId, chatId); cache.saveMessages(userId, chatId, (existing.filter { it.id != parsed.id } + parsed).sortedBy { it.id }) }
            if (type == "message" && parsed.senderId != userId) streams[userId]?.receipts?.received(chatId, parsed.id)
            events.tryEmit(NativeMessagingEvent(userId, type, parsed))
            signals.tryEmit(NativeSessionSignal(userId, "topic-activity", message.optLong("group_id", chatId), 0))
            if (!event.optBoolean("notify", true) || !message.isNull("deleted_at")) return
            val settings = NativeNotificationPolicy.prefs(this, userId)
            if (chatId.toString() in settings.getStringSet("mutedChats", emptySet()).orEmpty()) return
            val reaction = event.optJSONObject("reaction")
            val sender = message.optLong("sender_id")
            val replyToMe = message.optJSONObject("reply")?.optLong("sender_id") == userId
            val accounts = NativeAccounts.list(this)
            val account = accounts.firstOrNull { it.user.id == userId }
            val username = account?.user?.username.orEmpty()
            val mentioned = username.isNotBlank() && Regex("(?i)(?<![a-z0-9_])@" + Regex.escape(username) + "(?![a-z0-9_])").containsMatchIn(message.optString("text"))
            val isReaction = type == "message-update" && reaction?.optBoolean("active") == true && reaction.optLong("user_id") != userId && sender == userId
            if (isReaction) { if (!settings.getBoolean("reactions", true)) return }
            else {
                if (type != "message" || sender == userId) return
                val allowed = if (replyToMe) settings.getBoolean("replies", true) else if (mentioned) settings.getBoolean("mentions", true) else settings.getBoolean("messages", true)
                if (!allowed) return
            }
            if (nativeNotificationChatVisible(MainActivity.isVisible, MainActivity.visibleAccountId, MainActivity.visibleChatId, userId, chatId)) return
            val id = message.optLong("id")
            val chat = cache.chats(userId).firstOrNull { it.id == chatId }
            val senderName = notificationSenderName(userId, sender, message.optString("sender_name"), message.optString("sender_username"), chat)
            val title = if (isReaction) "Новая реакция" else nativeNotificationTitle(
                senderName,
                message.optString("group_name"), message.optString("topic_name"), !message.isNull("topic_id")
            )
            val preview = if (isReaction) "${reaction?.optString("emoji")} на ваше сообщение" else message.optString("text").ifBlank { message.optJSONObject("attachment")?.optString("name") ?: "Вложение" }
            val body = if (settings.getBoolean("preview", true)) preview else if (isReaction) "Реакция на сообщение" else "Новое сообщение"
            val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            launch.data = Uri.parse("volna://notification/$userId/$id/${if (isReaction) "reaction" else "message"}")
            launch.putExtra("chat_id", chatId).putExtra("message_id", id).putExtra("account_id", userId)
            val notificationId = ((id xor (id ushr 32)).toInt() and 0x1fffffff) + if (isReaction) 0x20000000 else 0
            val pending = PendingIntent.getActivity(this, notificationId, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val channel = if (event.optBoolean("silent")) SILENT_CHANNEL else NativeNotificationSounds.messageChannel(this, userId)
            val notificationBuilder = builder(nativeNotificationBrandTitle(title, settings.getBoolean("watch_brand_label",false)), body, channel).setContentIntent(pending).setAutoCancel(true)
                .setGroup("volna-messages-$userId").setOnlyAlertOnce(false)
            var wearableReply: Notification.Action? = null
            if(!isReaction&&chat?.canSend!=false){
                val replyIntent=Intent(this,NotificationReplyReceiver::class.java).setAction("dev.volna.messenger.REPLY").setData(Uri.parse("volna://reply/$userId/$chatId/$id"))
                val replyPending=PendingIntent.getBroadcast(this,notificationId,replyIntent,PendingIntent.FLAG_UPDATE_CURRENT or if(Build.VERSION.SDK_INT>=31)PendingIntent.FLAG_MUTABLE else 0)
                val input=android.app.RemoteInput.Builder("volna_reply").setLabel("Ответить").build()
                val action=Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this,R.drawable.ic_volna_notification),"Ответить",replyPending).addRemoteInput(input).setAllowGeneratedReplies(true).addExtras(android.os.Bundle().apply { putBoolean("android.support.action.showsUserInterface", false) }).apply{if(Build.VERSION.SDK_INT>=28)setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY)}.build()
                notificationBuilder.addAction(action)
                wearableReply = action
            }
            val group=chat?.kind in listOf("group","channel")||!message.isNull("topic_id")
            val conversationLabel=chat?.name?.ifBlank{title}?:title
            val artworkSender=if(isReaction)reaction?.optLong("user_id")?:sender else sender
            val artworkName=if(isReaction)cache.profile(userId,artworkSender)?.name?:"Реакция" else senderName
            val senderFallback=NativeNotificationAvatar.initials(artworkName,artworkSender)
            val conversationFallback=if(group)NativeNotificationAvatar.initials(conversationLabel,chatId)else senderFallback
            val notificationTime=System.currentTimeMillis()
            val postedElapsed=android.os.SystemClock.elapsedRealtime()
            val generation=artworkGeneration.incrementAndGet()
            notificationBuilder.addExtras(android.os.Bundle().apply{putLong("volna.artwork.generation",generation)})
            fun artwork(senderBitmap: android.graphics.Bitmap?,conversationBitmap: android.graphics.Bitmap?,key:String){
                if(!isReaction)NativeNotificationConversation.attach(this,notificationBuilder,userId,chatId,conversationLabel,senderName,body,notificationTime,launch,group=group,senderId=sender,senderAvatar=senderBitmap?:senderFallback,conversationAvatar=conversationBitmap?:conversationFallback,artworkKey=key)
                else notificationBuilder.setLargeIcon(senderBitmap?:senderFallback)
            }
            val avatarPerson=cache.profile(userId,artworkSender)?:cache.contacts(userId).firstOrNull{it.id==artworkSender}
            val initialSenderUrl=chat?.takeIf{it.kind=="direct"&&it.peerId==artworkSender}?.avatarUrl?:avatarPerson?.avatarUrl
            val initialConversationUrl=if(group){if((chat?.parentId?:0L)>0)cache.chats(userId).firstOrNull{it.id==chat?.parentId}?.avatarUrl else chat?.avatarUrl}else initialSenderUrl
            val cachedSender=NativeNotificationAvatar.cached(token,initialSenderUrl)
            val cachedConversation=if(!group||initialConversationUrl==initialSenderUrl)cachedSender else NativeNotificationAvatar.cached(token,initialConversationUrl)
            artwork(cachedSender,cachedConversation,if(cachedSender!=null||cachedConversation!=null)"photo:$initialSenderUrl:$initialConversationUrl" else "initials:$conversationLabel:$artworkName")
            notificationBuilder.extend(nativeNotificationWearable(userId,chatId,id,if(isReaction)"reaction" else "message",wearableReply))
            val manager=getSystemService(NotificationManager::class.java)
            val tag="volna-account-$userId"
            manager.notify(tag,notificationId,notificationBuilder.build())
            notificationScope.launch {
                avatarLoads.withPermit {
                    fun stillActive()=manager.activeNotifications.any{it.tag==tag&&it.id==notificationId&&it.notification.extras.getLong("volna.artwork.generation")==generation}
                    try {
                        // NMS can enqueue the initial notification asynchronously. Wait briefly
                        // for registration; never repost artwork after the card was dismissed.
                        while(!stillActive()){
                            if(android.os.SystemClock.elapsedRealtime()-postedElapsed>=750)return@withPermit
                            delay(50)
                        }
                        var senderUrl=initialSenderUrl
                        if(senderUrl==null&&avatarPerson==null){val fresh=api.userProfile(token,artworkSender);cache.saveProfile(userId,fresh);senderUrl=fresh.avatarUrl}
                        val senderBitmap=NativeNotificationAvatar.load(this@MessagingService,token,senderUrl)
                        var conversationUrl=if(group)initialConversationUrl else senderUrl
                        if(group&&chat==null){val fresh=api.chats(token);cache.saveChats(userId,fresh);conversationUrl=fresh.firstOrNull{it.id==chatId}?.avatarUrl}
                        val conversationBitmap=if(!group||conversationUrl==senderUrl)senderBitmap else NativeNotificationAvatar.load(this@MessagingService,token,conversationUrl)
                        if(senderBitmap==null&&conversationBitmap==null)return@withPermit
                        main.post {
                          try {
                            if(stopped||!manager.areNotificationsEnabled()||!stillActive()||nativeNotificationChatVisible(MainActivity.isVisible,MainActivity.visibleAccountId,MainActivity.visibleChatId,userId,chatId)||NativeAccounts.list(this@MessagingService).none{it.user.id==userId})return@post
                            artwork(senderBitmap,conversationBitmap,"photo:$senderUrl:$conversationUrl")
                            manager.notify(tag,notificationId,notificationBuilder.setOnlyAlertOnce(true).build())
                          }catch(_:Exception){/* Permission changes must not crash the service. */}
                        }
                    }catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){/* Keep the initials; delivery never depends on the avatar. */}
                }
            }

        } catch (_: Exception) { }
    }

    private fun notificationSenderName(account: Long, sender: Long, serverName: String, serverUsername: String, chat: VolnaChat?): String {
        val rows = NativeContactBook(this, account).cached().optJSONArray("contacts")
        val contact = rows?.let { contacts -> (0 until contacts.length()).map { contacts.getJSONObject(it) }
            .firstOrNull { !it.optBoolean("deleted") && it.optLong("linked_user_id") == sender } }
        val person = contact?.optJSONObject("user")?.let(api::contactUser)
            ?: cache.profile(account, sender) ?: cache.contacts(account).firstOrNull { it.id == sender }
        val direct = chat?.takeIf { it.kind == "direct" && it.peerId == sender }
        return nativeNotificationName(
            custom = contact?.optString("custom_name").orEmpty(), phonebook = contact?.optString("phonebook_name").orEmpty(),
            profile = serverName.ifBlank { person?.name.orEmpty().ifBlank { direct?.name.orEmpty() } },
            username = serverUsername.ifBlank { person?.username.orEmpty().ifBlank { direct?.username.orEmpty() } },
            firstName = person?.firstName.orEmpty(), lastName = person?.lastName.orEmpty(),
            alternateNames = listOf(contact?.optString("display_name").orEmpty(), person?.name.orEmpty(), direct?.name.orEmpty())
        )
    }

    private fun serviceNotification(): Notification = builder("VLN", "Связь с сообщениями активна", STATUS_CHANNEL)
        .setOngoing(true).setOnlyAlertOnce(true).build()

    private fun builder(title: String, text: String, channel: String): Notification.Builder {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notification = nativeNotificationBuilder(this, channel, includeArtwork = false)
        return notification.setContentTitle(title).setContentText(text)
            .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(pending).setShowWhen(true)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Сообщения VLN", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
            manager.createNotificationChannel(NotificationChannel(SILENT_CHANNEL, "Сообщения без звука", NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(null, null); enableVibration(false) })
            manager.createNotificationChannel(NotificationChannel(STATUS_CHANNEL, "Связь", NotificationManager.IMPORTANCE_LOW))
        }
    }

    override fun onDestroy() {
        notificationScope.cancel()
        NativeIdleUpdater.stop()
        stopped = true
        priorityRingtones.keys.toList().forEach { clearBackgroundCall(it) }
        main.removeCallbacks(reconcile)
        streams.values.forEach { it.stop() }; streams.clear()
        client.dispatcher.cancelAll()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        internal val signals = MutableSharedFlow<NativeSessionSignal>(extraBufferCapacity = 64)
        internal val events = MutableSharedFlow<NativeMessagingEvent>(extraBufferCapacity = 64)
        private const val BACKGROUND_CALL_ID = 11035
        private const val ACTION_SYNC = "dev.volna.messenger.SYNC_MESSAGING"
        const val ACTION_STOP = "dev.volna.messenger.STOP_MESSAGING"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_USER_ID = "user_id"
        internal const val SILENT_CHANNEL = "volna_messages_silent"
        internal const val CHANNEL_ID = "volna_messages"
        private const val STATUS_CHANNEL = "volna_connection"
        private const val FOREGROUND_ID = 11022

        internal fun restore(context: Context) {
            if (NativeAccounts.list(context).isEmpty()) return
            // No token extras: onStartCommand restores the selected account from storage.
            context.startForegroundService(Intent(context, MessagingService::class.java))
        }

        fun start(context: Context, token: String, userId: Long) {
            val intent = Intent(context, MessagingService::class.java)
                .putExtra(EXTRA_TOKEN, token).putExtra(EXTRA_USER_ID, userId)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun stop(context: Context) {
            NativeCalls.configure(context, "")
            if (NativeAccounts.list(context).isEmpty()) context.stopService(Intent(context, MessagingService::class.java))
            else {
                val intent = Intent(context, MessagingService::class.java).setAction(ACTION_SYNC)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            }
        }
    }
}
