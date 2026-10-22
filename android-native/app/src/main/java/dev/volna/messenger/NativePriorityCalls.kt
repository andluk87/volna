package dev.volna.messenger

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/** Local, per-account exceptions; never change the phone's global sound settings. */
internal object NativePriorityCalls {
    fun enabled(context: Context, account: Long, peer: Long): Boolean = account > 0 && peer > 0 &&
        NativeNotificationPolicy.prefs(context, account).getBoolean("priority_call_$peer", false)

    fun play(context: Context, account: Long, call: VolnaCall): Ringtone? {
        if (!enabled(context, account, call.peer?.id ?: 0)) return null
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled() || manager.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL ||
            manager.getNotificationChannel(NativeCalls.CALL_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return null
        // Alarm audio remains audible in silent/vibrate mode. DND and alarm volume
        // remain under Android/user control; do not alter either globally.
        return runCatching {
            val uri = NativeNotificationSounds.callUri(context, account) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            RingtoneManager.getRingtone(context, uri)?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                if (Build.VERSION.SDK_INT >= 28) isLooping = true
                play()
            }
        }.getOrNull()
    }
}

@Composable
internal fun NativePriorityCallSetting(account: Long, peer: Long) {
    val context = LocalContext.current
    var enabled by remember(account, peer) { mutableStateOf(NativePriorityCalls.enabled(context, account, peer)) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            NativeText("Приоритетные звонки")
            NativeText("Звонить даже без звука. Громкость — как у будильника. Режим «Не беспокоить» сохраняется.", color = Muted)
        }
        Switch(checked = enabled, enabled = account > 0, onCheckedChange = {
            enabled = it
            NativeNotificationPolicy.prefs(context, account).edit().putBoolean("priority_call_$peer", it).apply()
        })
    }
}
