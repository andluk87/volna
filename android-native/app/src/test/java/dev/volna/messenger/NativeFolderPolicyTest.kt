package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeFolderPolicyTest {
    private fun chat(id: Long, kind: String = "direct", archived: Boolean = false, unread: Int = 0) =
        VolnaChat(id, "Чат", "", "", "", unread, false, 1, kind = kind, archived = archived)

    @Test fun renamedBuiltinStillIncludesFutureChats() {
        val folder = nativeDefaultFolders().first { it.rule == "group" }.copy(name = "Работа")
        assertTrue(nativeFolderMatches(folder, chat(100, "group")))
        assertFalse(nativeFolderMatches(folder, chat(101, "channel")))
        assertFalse(nativeFolderMatches(folder, chat(102, "group", archived = true)))
    }

    @Test fun manualExceptionsOverrideDynamicRules() {
        val folder = nativeDefaultFolders().first { it.rule == "unread" }.copy(chats = setOf(10), excluded = setOf(11))
        assertTrue(nativeFolderMatches(folder, chat(10)))
        assertFalse(nativeFolderMatches(folder, chat(11, unread = 2)))
        assertTrue(nativeFolderMatches(folder, chat(12, unread = 1)))
    }

    @Test fun emptyCustomFolderDoesNotSelectAllChats() {
        assertFalse(nativeFolderMatches(NativeFolder("custom", "Своя", emptySet()), chat(10)))
        val archive = nativeDefaultFolders().first { it.rule == "archived" }
        assertTrue(nativeFolderMatches(archive, chat(10, archived = true)))
        assertFalse(nativeFolderMatches(archive, chat(11)))
    }
}
