package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeNavigationSerializationTest {
    @Test fun callsCanReplaceSettingsWithoutLosingSavedStyleOrLegacyDefaults() {
        val calls = NativeNavigationStyle.Bottom.copy(thirdTab = "calls", radius = 12, labels = false)
        assertEquals(calls, NativeNavigationStyle.parse(calls.json(), NativeNavigationStyle.Bottom))
        assertEquals("calls", NativeNavigationStyle.parse("{}", NativeNavigationStyle.Bottom).thirdTab)
        assertEquals("calls", NativeNavigationStyle.parse("""{"thirdTab":"unknown"}""", NativeNavigationStyle.Bottom).thirdTab)
    }
    @Test fun railPreferencesReturnToHorizontalDefaultsWithoutLosingCustomColors() {
        val style = NativeNavigationStyle.parse("""{"vertical":true,"labels":false,"height":72,"sideInset":4,"iconSize":46,"selected":4281558681,"textSize":16}""", NativeNavigationStyle.Folders)
        assertTrue(style.labels)
        assertEquals(40, style.height)
        assertEquals(10, style.sideInset)
        assertEquals(23, style.iconSize)
        assertEquals(16, style.textSize)
        assertEquals(4281558681L, style.selected)
        assertFalse(style.json().contains("vertical"))
        assertEquals(style, NativeNavigationStyle.parse(style.json(), NativeNavigationStyle.Folders))
    }
    @Test fun originalHorizontalAndBottomPreferencesKeepTheirCustomGeometry() {
        val old = """{"height":64,"sideInset":4,"iconSize":46,"labels":false}"""
        val horizontal = NativeNavigationStyle.parse(old, NativeNavigationStyle.Folders)
        assertEquals(64, horizontal.height)
        assertEquals(4, horizontal.sideInset)
        assertEquals(46, horizontal.iconSize)
        assertFalse(horizontal.labels)
        val bottom = NativeNavigationStyle.Bottom.copy(height = 72, sideInset = 4, iconSize = 46, labels = false)
        assertEquals(bottom, NativeNavigationStyle.parse(bottom.json(), NativeNavigationStyle.Bottom))
    }
}
