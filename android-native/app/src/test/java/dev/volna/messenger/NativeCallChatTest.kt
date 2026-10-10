package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeCallChatTest {
    private fun record(id: String = "call", incoming: Boolean = false, status: String = "ended", created: Long = 2000) = VolnaCallRecord(id, 1, null, incoming, created, status, 5, false)
    private fun message(id: Long, time: Long) = VolnaMessage(id, 1, "Пользователь", "Текст", java.time.Instant.ofEpochMilli(time).toString(), false, null)
    @Test fun callsInterleaveWithMessagesByTimestampWithoutFakeMessageIds() {
        val entries = nativeChatTimeline(listOf(listOf(message(1, 1000)), listOf(message(2, 3000))), listOf(record()))
        assertEquals(listOf("message-1", "call-call", "message-2"), entries.map { it.key })
        assertEquals(listOf(1000L, 2000L, 3000L), entries.map { it.created })
        assertTrue(entries[1].messages.isEmpty())
    }
    @Test fun missedAndRejectedCallsHaveAccurateDirectionLabels() {
        assertEquals("Пропущенный звонок", nativeCallRecordTitle(record(incoming = true, status = "missed")))
        assertEquals("Нет ответа", nativeCallRecordTitle(record(status = "missed")))
        assertEquals("Отклонённый звонок", nativeCallRecordTitle(record(incoming = true, status = "declined")))
        assertEquals("Отменённый звонок", nativeCallRecordTitle(record(status = "cancelled")))
        assertEquals("Входящий звонок", nativeCallRecordTitle(record(incoming = true)))
    }
    @Test fun equalTimestampsHaveStableKeysForScrollAnchors() {
        val entries = nativeChatTimeline(listOf(listOf(message(1, 2000))), listOf(record(id = "b"), record(id = "a")))
        assertEquals(listOf("call-a", "call-b", "message-1"), entries.map { it.key })
    }
    @Test fun connectedStatusShowsOneTimerWithoutConnectionPlaceholder() {
        assertEquals("01:03", nativeCallStatus(NativeCallState(connected = true, elapsed = 63)))
        assertEquals("Соединение…", nativeCallStatus(NativeCallState()))
    }
}
