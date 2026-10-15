package dev.volna.messenger

/** Coalesce bursts per chat; a failed request stays pending, a late ACK cannot erase a newer ID. */
internal class NativeDeliveryQueue {
    private val pending = mutableMapOf<Long, Long>()
    @Synchronized fun received(chat: Long, message: Long) {
        if (chat > 0 && message > 0) pending[chat] = maxOf(pending[chat] ?: 0, message)
    }
    @Synchronized fun snapshot(): Map<Long, Long> = pending.toMap()
    @Synchronized fun acknowledged(chat: Long, message: Long) {
        if ((pending[chat] ?: Long.MAX_VALUE) <= message) pending.remove(chat)
    }
}
