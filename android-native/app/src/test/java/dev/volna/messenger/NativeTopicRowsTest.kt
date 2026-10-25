package dev.volna.messenger

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class NativeTopicRowsTest {
    private fun topic(id: Long, at: String, pinned: Boolean = false, order: Int = 0, hidden: Boolean = false) =
        JSONObject().put("id", id).put("last_at", at).put("pinned", pinned).put("pin_order", order).put("hidden", hidden)

    @Test fun pinnedOrderWinsOverActivityAndHiddenTopicsStayPrivate() {
        val data = JSONObject().put("general", topic(1, "2026-10-25T10:00:00Z", hidden = true))
            .put("topics", JSONArray(listOf(topic(2, "2026-10-24T10:00:00Z"), topic(3, "2026-10-25T09:00:00Z"),
                topic(4, "2026-10-20T10:00:00Z", true, 1), topic(5, "2026-10-19T10:00:00Z", true, 0))))
        assertEquals(listOf(5L, 4L, 3L, 2L), nativeTopicRows(data, false).map { it.getLong("id") })
        assertEquals(listOf(5L, 4L, 1L, 3L, 2L), nativeTopicRows(data, true).map { it.getLong("id") })
    }

    @Test fun topicDatesUseLocalDayAndEmptyHistoryHasNoDate() {
        val now = Instant.parse("2026-10-25T00:30:00Z")
        val zone = ZoneId.of("Europe/Moscow")
        assertEquals("02:00", nativeTopicDate("2026-10-24T23:00:00Z", now, zone))
        assertTrue(nativeTopicDate("2025-10-24T10:00:00Z", now, zone).endsWith("25"))
        assertEquals("", nativeTopicDate("null", now, zone))
        assertEquals("", nativeTopicDate("", now, zone))
    }
}
