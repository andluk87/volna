package dev.volna.messenger

import android.app.Notification

/** Synchronization IDs belong to Volna and preserve account/chat/message boundaries. */
internal fun nativeNotificationWearable(account: Long, chat: Long, message: Long, kind: String, reply: Notification.Action? = null): Notification.WearableExtender =
    Notification.WearableExtender()
        .setBridgeTag("volna-account-$account")
        .setDismissalId("volna-$kind-$account-$chat-$message")
        .apply { if (reply != null) addAction(reply) }
