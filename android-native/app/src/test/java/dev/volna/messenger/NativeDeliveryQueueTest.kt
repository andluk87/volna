package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeDeliveryQueueTest {
    @Test fun lateReceiptKeepsNewMessageAndRetriesDoNotDropAnything() {
        val queue = NativeDeliveryQueue()
        queue.received(1, 10)
        val request = queue.snapshot()
        queue.received(1, 11)
        queue.received(1, 9)
        queue.acknowledged(1, request.getValue(1))
        assertEquals(mapOf(1L to 11L), queue.snapshot())
        assertEquals(queue.snapshot(), queue.snapshot()) // failed network attempt leaves the snapshot intact
        queue.acknowledged(1, 11)
        assertTrue(queue.snapshot().isEmpty())
    }
    @Test fun chatsAreIndependentAndInvalidMessagesAreIgnored() {
        val queue = NativeDeliveryQueue()
        queue.received(1, 10); queue.received(2, 20)
        queue.received(0, 99); queue.received(1, -1)
        queue.acknowledged(1, 10)
        assertEquals(mapOf(2L to 20L), queue.snapshot())
    }
}
