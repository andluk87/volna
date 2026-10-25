package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeFolderRailTest {
    @Test fun unreadBadgesUseFolderRulesAndDoNotDoubleCountAssignedChatsInAll() {
        val chats = listOf(
            VolnaChat(1, "Работа", "", "", "", 5, false, 1),
            VolnaChat(2, "Личное", "", "", "", 0, false, 2, manualUnread = true),
            VolnaChat(3, "Архив", "", "", "", 3, false, 3, archived = true),
            VolnaChat(4, "Прочитано", "", "", "", 0, false, 4))
        val tabs = nativeNavigationFolders(listOf(NativeFolder("work", "Работа", setOf(1))), chats)
        assertEquals(1, nativeFolderUnread(tabs[0], chats, tabs))
        assertEquals(1, nativeFolderUnread(tabs[1], chats, tabs))
        assertEquals(1, nativeFolderUnread(NativeFolder("archive", "Архив", emptySet(), "archived"), chats, tabs))
    }
}
