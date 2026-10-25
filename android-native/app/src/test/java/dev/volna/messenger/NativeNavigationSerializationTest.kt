package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeNavigationSerializationTest {
    @Test fun oldFolderPreferencesUseRailWithoutLosingCustomizations() {
        val style = NativeNavigationStyle.parse("""{"height":64,"labels":true,"textSize":16,"iconSize":23,"selected":4281558681}""", NativeNavigationStyle.Folders)
        assertTrue(style.vertical)
        assertTrue(style.labels)
        assertEquals(64, style.height)
        assertEquals(16, style.textSize)
        assertEquals(46, style.iconSize)
        assertEquals(4281558681L, style.selected)
        assertEquals(style.copy(vertical = false), NativeNavigationStyle.parse(style.copy(vertical = false).json(), NativeNavigationStyle.Folders))
        assertFalse(NativeNavigationStyle.parse("{}", NativeNavigationStyle.Bottom).vertical)
    }
}
