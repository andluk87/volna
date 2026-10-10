package dev.volna.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.security.MessageDigest

internal object NativeNotificationSounds {
    private fun account(context: Context) = context.getSharedPreferences("volna-native", 0).getLong("user_id", 0)
    private fun uri(context: Context, account: Long, key: String, type: Int): Uri? {
        val value = NativeNotificationPolicy.prefs(context, account).getString(key, null)
        return if (value == null) RingtoneManager.getDefaultUri(type) else value.takeIf { it.isNotBlank() }?.let(Uri::parse)
    }
    fun callUri(context: Context) = uri(context, account(context), "call_sound_uri", RingtoneManager.TYPE_RINGTONE)
    fun callAlertsAllowed(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() && manager.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL &&
            (manager.getNotificationChannel(NativeCalls.CALL_CHANNEL)?.importance ?: NotificationManager.IMPORTANCE_HIGH) != NotificationManager.IMPORTANCE_NONE &&
            context.getSystemService(AudioManager::class.java).ringerMode != AudioManager.RINGER_MODE_SILENT
    }
    fun callSoundAllowed(context: Context) = callAlertsAllowed(context) &&
        context.getSystemService(AudioManager::class.java).ringerMode == AudioManager.RINGER_MODE_NORMAL && NativeNotificationPolicy.prefs(context, account(context)).getBoolean("call_sound", true)
    fun callVibrationAllowed(context: Context) = callAlertsAllowed(context) && NativeNotificationPolicy.prefs(context, account(context)).getBoolean("call_vibration", true)
    fun messageChannel(context: Context, account: Long): String {
        val prefs = NativeNotificationPolicy.prefs(context, account)
        val sound = prefs.getBoolean("sound", true)
        val vibration = prefs.getBoolean("message_vibration", true)
        // Preserve the old Android channel's user settings until an explicit sound/vibration choice.
        if (!prefs.contains("message_sound_uri") && !prefs.contains("message_vibration")) return if (sound) MessagingService.CHANNEL_ID else MessagingService.SILENT_CHANNEL
        val selected = if (sound) uri(context, account, "message_sound_uri", RingtoneManager.TYPE_NOTIFICATION) else null
        val digest = MessageDigest.getInstance("SHA-256").digest("$selected:$vibration".toByteArray()).take(6).joinToString("") { "%02x".format(it) }
        val id = "volna-message-$account-$digest"
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(id, "Сообщения Волны", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(selected, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
            enableVibration(vibration); if (vibration) vibrationPattern = longArrayOf(0, 160, 100, 160)
        })
        return id
    }
}

internal object NativeCallVibration {
    private var vibrator: Vibrator? = null
    fun start(context: Context) {
        stop()
        if (!NativeNotificationSounds.callVibrationAllowed(context)) return
        val device = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java).defaultVibrator else context.getSystemService(Vibrator::class.java)
        if (!device.hasVibrator()) return
        vibrator = device
        runCatching { device.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 700, 700), 0), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()) }
    }
    fun stop() { val old = vibrator; vibrator = null; runCatching { old?.cancel() } }
}
