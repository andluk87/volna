package dev.volna.messenger

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeTopicRowsTest {
    private fun topic(id: Long, last: Long, pinned: Boolean = false, order: Int = 0) = JSONObject().put("id", id).put("last_id", last).put("pinned", pinned).put("pin_order", order)
    @Test fun pinsFirstThenActivityAndStableIdWithoutChangingReadState() {
        val general = topic(1, 20); val newest = topic(2, 50); val pin = topic(3, 1, true, 1); val firstPin = topic(4, 0, true, 0)
        val info = JSONObject().put("general", general).put("topics", JSONArray(listOf(newest, pin, firstPin, topic(5, 30))))
        assertEquals(listOf(4L,3L,2L,5L,1L), nativeTopicRows(info).map { it.getLong("id") })
        assertEquals(20, general.getInt("last_id")); assertEquals(emptyList<JSONObject>(), nativeTopicRows(null))
    }
    @Test fun previewHasSenderAndEmptyTopicHasUsefulHint() {
        val row = topic(2, 50).put("last_sender", "Анна").put("last_text", "Макеты готовы")
        assertEquals("Анна: Макеты готовы", nativeTopicPreview(row))
        assertEquals("Пока нет сообщений", nativeTopicPreview(topic(3, 0)))
    }
    @Test fun backFromGeneralAndChildReturnsToTopicListWhileOrdinaryChatsExit() {
        val general=VolnaChat(1,"Группа","","","",0,false,0,kind="group",topicsEnabled=true)
        val child=general.copy(id=2,parentId=1)
        assertEquals(general,nativeTopicParent(child,listOf(general,child)))
        assertEquals(general,nativeTopicParent(general,listOf(general,child)))
        assertNull(nativeTopicParent(general.copy(kind="direct"),listOf(general)))
        assertNull(nativeTopicParent(general.copy(topicsEnabled=false),emptyList()))
    }
    @Test fun topicHeaderSurvivesOfflineChatCache() {
        val row = VolnaChat(42,"Команда › Дизайн","","","",0,false,0,kind="group",parentId=10,topicTitle="Дизайн",topicIcon="🎨",parentName="Команда")
        assertEquals(row,NativeCodec.chats(JSONArray().put(NativeCodec.chat(row))).single())
    }
}
