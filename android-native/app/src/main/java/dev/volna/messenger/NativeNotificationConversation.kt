package dev.volna.messenger

import android.app.Notification
import android.app.Person
import android.graphics.Bitmap
import java.util.concurrent.ConcurrentHashMap
import android.content.Context
import android.content.Intent
import android.content.LocusId
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build

/** Stable conversation identities are account-scoped; no credentials go into launcher shortcuts. */
internal fun nativeConversationId(account: Long, chat: Long, test: Boolean = false): String =
    "volna-conversation-$account-${if (test) "test" else chat.toString()}"

internal object NativeNotificationConversation {
    private val artworkKeys=ConcurrentHashMap<String,String>()
    fun attach(context: Context, builder: Notification.Builder, account: Long, chat: Long,
               label: String, sender: String, body: String, time: Long, launch: Intent,
               group: Boolean = false, test: Boolean = false, senderId: Long? = null, senderAvatar: Bitmap? = null, conversationAvatar: Bitmap? = null, artworkKey: String = "initials") {
        val name = sender.ifBlank { "Собеседник" }
        val conversation = nativeConversationId(account, chat, test)
        val senderBitmap=senderAvatar?:if(test)NativeNotificationArtwork.round(context)else NativeNotificationAvatar.initials(name,senderId?:chat)
        val conversationBitmap=conversationAvatar?:if(group)NativeNotificationAvatar.initials(label,chat)else senderBitmap
        builder.setLargeIcon(conversationBitmap)
        val person = if (Build.VERSION.SDK_INT >= 28) Person.Builder().setName(name)
            .setIcon(Icon.createWithBitmap(senderBitmap)).setKey(if (senderId != null) "volna-person-$account-$senderId" else "$conversation-sender").build() else null
        val style = if (Build.VERSION.SDK_INT >= 28) {
            val owner = Person.Builder().setName("Вы").setKey("volna-account-$account").build()
            Notification.MessagingStyle(owner).setGroupConversation(group)
                .apply { if (group) setConversationTitle(label) }.addMessage(body, time, person)
        } else {
            @Suppress("DEPRECATION")
            Notification.MessagingStyle("Вы").apply { if (group) setConversationTitle(label) }.addMessage(body, time, name)
        }
        builder.setStyle(style)
        builder.setShortcutId(null)
        // Shortcut quotas or launcher restrictions must never prevent message delivery.
        runCatching {
            val manager = context.getSystemService(ShortcutManager::class.java) ?: return@runCatching
            val id = conversation
            val current = manager.dynamicShortcuts
            val existing = current.firstOrNull { it.id == id }
            if (existing == null || existing.shortLabel?.toString() != label.take(80) || artworkKeys[id]!=artworkKey) {
                if (manager.isRateLimitingActive) return@runCatching
                manager.enableShortcuts(listOf(id))
                val intent = Intent(launch).setAction(Intent.ACTION_VIEW)
                    .setData(Uri.parse("volna://conversation/$account/${if (test) "test" else chat}"))
                    .removeMessagePosition()
                val shortcut = ShortcutInfo.Builder(context, id).setShortLabel(label.ifBlank { name }.take(80))
                    .setIntent(intent).setIcon(Icon.createWithBitmap(conversationBitmap))
                    .setCategories(setOf("android.shortcut.conversation"))
                    .apply {
                        if (Build.VERSION.SDK_INT >= 29) {
                            setLongLived(true)
                            setLocusId(LocusId(id))
                            setPersons(arrayOf(requireNotNull(person)))
                        }
                    }.build()
                val limit = manager.maxShortcutCountPerActivity
                if (existing == null && current.size >= limit) {
                    val removable = current.filter { it.id.startsWith("volna-conversation-") }
                        .sortedBy { it.lastChangedTimestamp }.take(current.size - limit + 1)
                    if (removable.isEmpty()) return@runCatching
                    manager.removeDynamicShortcuts(removable.map { it.id })
                    removable.forEach{artworkKeys.remove(it.id)}
                }
                if (!manager.addDynamicShortcuts(listOf(shortcut))) return@runCatching
                artworkKeys[id]=artworkKey
            }
            builder.setShortcutId(id)
            if (Build.VERSION.SDK_INT >= 29) builder.setLocusId(LocusId(id))
            manager.reportShortcutUsed(id)
        }
    }

    private fun Intent.removeMessagePosition(): Intent = apply { removeExtra("message_id") }

    fun removeAccount(context: Context, account: Long) {
        NativeNotificationAvatar.removeAccount(account)
        runCatching {
            val manager = context.getSystemService(ShortcutManager::class.java) ?: return@runCatching
            val shortcuts = if (Build.VERSION.SDK_INT >= 30) manager.getShortcuts(
                ShortcutManager.FLAG_MATCH_DYNAMIC or ShortcutManager.FLAG_MATCH_CACHED or ShortcutManager.FLAG_MATCH_PINNED
            ) else manager.dynamicShortcuts + manager.pinnedShortcuts
            val ids = shortcuts.filter { it.id.startsWith("volna-conversation-$account-") }.map { it.id }.distinct()
            ids.forEach{artworkKeys.remove(it)}
            manager.disableShortcuts(ids)
            manager.removeDynamicShortcuts(ids)
            if (Build.VERSION.SDK_INT >= 30) manager.removeLongLivedShortcuts(ids)
        }
    }
}
