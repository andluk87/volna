package dev.volna.messenger

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Local compatibility test: never uses credentials, calls the API or switches accounts. */
class NotificationTestReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "dev.volna.messenger.TEST_REPLY" || intent.data?.scheme != "volna" || intent.data?.host != "watch-test-reply") return
        val parts = intent.data?.pathSegments.orEmpty()
        if (parts.size != 2) return
        val account = parts[0].toLongOrNull() ?: return
        val timestamp = parts[1].toLongOrNull()?.takeIf { it > 0 } ?: return
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence("volna_test_reply") ?: return
        if (reply.isBlank()) return
        NativeNotificationTest.acceptReply(context, account, timestamp)
    }
}
