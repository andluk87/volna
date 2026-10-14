package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeFolderNavigationTest {
    private val chats = (1L..3L).map { VolnaChat(it,"Чат $it","","","",1,false,it) }
    @Test fun emptyFoldersHaveNoTabsAndAllIsUniqueAndUnassigned() {
        assertTrue(nativeNavigationFolders(emptyList(), chats).isEmpty())
        assertTrue(nativeNavigationFolders(listOf(NativeFolder("a","А",emptySet())), chats).isEmpty())
        val tabs = nativeNavigationFolders(listOf(NativeFolder("builtin_all","Все чаты",emptySet(),"all"),NativeFolder("duplicate","Все чаты",emptySet()),NativeFolder("a","А",setOf(1L))),chats)
        assertEquals(listOf("Все чаты","А"),tabs.map { it.name })
        assertEquals(listOf(2L,3L),chats.filter { nativeUnassignedChat(it,tabs) }.map { it.id })
    }
}
