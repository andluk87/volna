package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeUiLogicTest {
    private fun chat(kind: String = "direct", unread: Int = 0, archived: Boolean = false) = VolnaChat(1, "Чат", "name", "", "", unread, kind == "saved", 2, kind = kind, archived = archived)
    private fun message(sender: Long, at: String, deleted: Boolean = false) = VolnaMessage(1, sender, "Автор", "Текст", at, deleted, null)
    @Test fun chatFiltersRespectArchiveAndKinds() {
        assertTrue(nativeChatFilter(chat("saved"), "direct"))
        assertFalse(nativeChatFilter(chat("group"), "direct"))
        assertTrue(nativeChatFilter(chat("group"), "group"))
        assertFalse(nativeChatFilter(chat("channel"), "group"))
        assertTrue(nativeChatFilter(chat(unread = 2), "unread"))
        assertFalse(nativeChatFilter(chat(unread = 2, archived = true), "unread"))
        assertTrue(nativeChatFilter(chat(archived = true), "archived"))
        assertFalse(nativeChatFilter(chat(archived = true), "all"))
    }
    @Test fun groupingNeverCombinesDifferentAuthorsOrDeletedMessages() {
        val first = message(1, "2026-10-06T12:00:00Z")
        assertTrue(nativeSameAuthor(first, message(1, "2026-10-06T12:05:00Z")))
        assertFalse(nativeSameAuthor(first, message(1, "2026-10-06T12:05:01Z")))
        assertFalse(nativeSameAuthor(first, message(2, "2026-10-06T12:01:00Z")))
        assertFalse(nativeSameAuthor(first, message(1, "2026-10-06T11:59:00Z")))
        assertFalse(nativeSameAuthor(first, message(1, "2026-10-06T12:01:00Z", true)))
        assertFalse(nativeSameAuthor(null, first))
    }
    @Test fun incomingMessagesPreserveReadingPositionButOwnMessagesFollow() {
        assertFalse(nativeShouldFollow(15, 100, 2, 1))
        assertTrue(nativeShouldFollow(98, 100, 2, 1))
        assertTrue(nativeShouldFollow(15, 100, 1, 1))
        assertTrue(nativeShouldFollow(0, 0, 2, 1))
    }
    @Test fun voiceGestureSupportsTapHoldCancelAndLock() {
        assertEquals("lock", NativeVoiceGesture().release(249))
        assertEquals("send", NativeVoiceGesture().release(250))
        val cancel = NativeVoiceGesture(); cancel.move(-80f, 0f); cancel.move(0f, -100f)
        assertEquals("cancel", cancel.release(1000))
        val lock = NativeVoiceGesture(); lock.move(0f, -72f); lock.move(-150f, 0f)
        assertEquals("lock", lock.release(1000))
        val small = NativeVoiceGesture(); small.move(-79f, -71f)
        assertEquals("send", small.release(1000))
    }
}
