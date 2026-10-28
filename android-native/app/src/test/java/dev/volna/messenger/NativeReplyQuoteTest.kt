package dev.volna.messenger

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeReplyQuoteTest {
    private fun message(sourceChat: Long, canJump: Boolean) = JSONObject()
        .put("id", 10).put("chat_id", 2).put("text", "Куплю").put("created_at", "2026-10-28T10:00:00Z")
        .put("reply", JSONObject().put("id", 1).put("name", "Анна").put("text", "Туалетная бумага")
            .put("chat_id", sourceChat).put("can_jump", canJump).put("quote", JSONObject().put("text", "Туалетная бумага").put("offset", 12)))

    @Test fun fragmentAndUnavailableSourceSurviveOfflineCache() {
        val parsed = NativeApi("https://example.invalid").parseMessage(message(1, false))
        assertEquals("Туалетная бумага", parsed.reply!!.text)
        assertFalse(parsed.reply.canJump)
        val restored = NativeCodec.message(NativeCodec.message(parsed))
        assertEquals(parsed.reply, restored.reply)
    }

    @Test fun localQuoteCanJumpButForeignQuoteDoesNotScrollCurrentChat() {
        val api = NativeApi("https://example.invalid")
        assertTrue(api.parseMessage(message(2, true)).reply!!.canJump)
        assertFalse(api.parseMessage(message(1, true)).reply!!.canJump)
    }
}
