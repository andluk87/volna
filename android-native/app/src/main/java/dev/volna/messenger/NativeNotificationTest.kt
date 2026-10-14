package dev.volna.messenger

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class NativeNotificationTestStatus(val account: Long, val message: String, val pending: Boolean = false)

/** One local test survives closing settings so the user can lock the phone before delivery. */
internal object NativeNotificationTest {
    private const val TAG = "volna-watch-test"
    private const val ID = 11091
    private const val DELAY_MS = 10_000L
    private val handler = Handler(Looper.getMainLooper())
    private val mutableStatus = MutableStateFlow<NativeNotificationTestStatus?>(null)
    val status = mutableStatus.asStateFlow()
    private var scheduled: Runnable? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastDelivered: Pair<Long, Long>? = null

    fun schedule(context: Context, account: Long) {
        clearPending()
        lastDelivered = null
        val app = context.applicationContext
        try {
            channel(app, account)
            // Keep the explicitly requested short test on time after the user locks the phone.
            // PARTIAL_WAKE_LOCK leaves the screen off; the timeout bounds it if delivery stalls.
            val lock = app.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "volna:notification-test")
            lock.setReferenceCounted(false)
            wakeLock = lock
            lock.acquire(DELAY_MS + 5_000L)
        } catch (problem: Exception) {
            releaseWakeLock()
            mutableStatus.value = NativeNotificationTestStatus(account, problem.message ?: "Не удалось подготовить уведомление")
            return
        }
        mutableStatus.value = NativeNotificationTestStatus(account, "Уведомление появится через 10 секунд. Можно заблокировать телефон.", pending = true)
        val task = Runnable {
            scheduled = null
            try {
                val manager = app.getSystemService(NotificationManager::class.java)
                val selectedChannel = channel(app, account)
                val launch = Intent(app, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .setData(Uri.parse("volna://watch-test/$account"))
                val open = PendingIntent.getActivity(app, ID, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                val title = if (NativeNotificationPolicy.prefs(app, account).getBoolean("watch_brand_label", false)) nativeNotificationBrandTitle("Проверка уведомлений", true) else "Волна · Проверка уведомлений"
                val text = "Проверка значков Telegram в Волне"
                val now = System.currentTimeMillis()
                val style = if (Build.VERSION.SDK_INT >= 28) {
                    val owner = Person.Builder().setName("Вы").setKey("volna-test-account-$account").build()
                    val sender = Person.Builder().setName(title).setKey("volna-watch-test-sender").build()
                    Notification.MessagingStyle(owner).setGroupConversation(false).addMessage(text, now, sender)
                } else {
                    @Suppress("DEPRECATION")
                    Notification.MessagingStyle("Вы").addMessage(text, now, title)
                }
                val replyIntent = Intent(app, NotificationTestReplyReceiver::class.java)
                    .setAction("dev.volna.messenger.TEST_REPLY")
                    .setData(Uri.parse("volna://watch-test-reply/$account/$now"))
                val replyPending = PendingIntent.getBroadcast(app, ID, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val reply = Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(app, R.drawable.telegram_diagnostic_small), "Ответить", replyPending)
                    .addRemoteInput(android.app.RemoteInput.Builder("volna_test_reply").setLabel("Тестовый ответ — никому не отправляется").build())
                    .setAllowGeneratedReplies(true).addExtras(android.os.Bundle().apply { putBoolean("android.support.action.showsUserInterface", false) })
                    .apply { if (Build.VERSION.SDK_INT >= 28) setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY) }.build()
                val notification = nativeNotificationBuilder(app, selectedChannel, includeArtwork = false)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(style)
                    .addAction(reply)
                    .extend(nativeNotificationWearable(account, 0, now, "test", reply))
                    .setWhen(now)
                    .setCategory(Notification.CATEGORY_MESSAGE)
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setContentIntent(open)
                    .setShowWhen(true)
                    .setAutoCancel(true)
                    .build()
                manager.notify(TAG, ID, notification)
                lastDelivered = account to now
                mutableStatus.value = NativeNotificationTestStatus(account, "Тест с временными значками Telegram отправлен. Посмотрите на телефоне и часах.")
            } catch (problem: Exception) {
                mutableStatus.value = NativeNotificationTestStatus(account, problem.message ?: "Не удалось отправить проверочное уведомление")
            } finally {
                releaseWakeLock()
            }
        }
        scheduled = task
        if (!handler.postDelayed(task, DELAY_MS)) {
            clearPending()
            mutableStatus.value = NativeNotificationTestStatus(account, "Не удалось запланировать проверку. Попробуйте ещё раз.")
        }
    }

    fun acceptReply(context: Context, account: Long, timestamp: Long) {
        if (lastDelivered != (account to timestamp)) return
        lastDelivered = null
        context.getSystemService(NotificationManager::class.java).cancel(TAG, ID)
        mutableStatus.value = NativeNotificationTestStatus(account, "Тестовый ответ получен локально. Сообщение никому не отправлено.")
    }

    fun cancel(account: Long) {
        if (mutableStatus.value?.account != account || scheduled == null) return
        clearPending()
        mutableStatus.value = NativeNotificationTestStatus(account, "Проверка отменена")
    }

    private fun clearPending() {
        scheduled?.let(handler::removeCallbacks)
        scheduled = null
        releaseWakeLock()
    }

    private fun releaseWakeLock() {
        val lock = wakeLock
        wakeLock = null
        if (lock != null) runCatching { if (lock.isHeld) lock.release() }
    }

    private fun channel(context: Context, account: Long): String {
        val manager = context.getSystemService(NotificationManager::class.java)
        check(manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)) {
            "Разрешите уведомления Волны в разделе «Уведомления Android» ниже"
        }
        val id = NativeNotificationSounds.messageChannel(context, account)
        if (manager.getNotificationChannel(id) == null) {
            val baseline = when (id) {
                MessagingService.CHANNEL_ID -> NotificationChannel(id, "Сообщения Волны", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) }
                MessagingService.SILENT_CHANNEL -> NotificationChannel(id, "Сообщения без звука", NotificationManager.IMPORTANCE_DEFAULT).apply { setSound(null, null); enableVibration(false) }
                else -> error("Откройте Волну ещё раз, чтобы подготовить уведомления сообщений")
            }
            manager.createNotificationChannel(baseline)
        }
        val selected = checkNotNull(manager.getNotificationChannel(id)) { "Откройте Волну ещё раз, чтобы подготовить уведомления сообщений" }
        check(selected.importance != NotificationManager.IMPORTANCE_NONE) {
            "Включите уведомления сообщений в разделе «Уведомления Android» ниже"
        }
        return id
    }
}
