package dev.volna.messenger

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeFolderTabLayoutTest {
    @Test fun equalTabsFillEveryPixelUntilLabelsNoLongerFit() {
        assertEquals(listOf(361), nativeFolderTabWidths(361, listOf(100)))
        assertEquals(listOf(181, 180), nativeFolderTabWidths(361, listOf(100, 100)))
        assertEquals(listOf(121, 120, 120), nativeFolderTabWidths(361, listOf(121, 120, 120)))
        // Losing one pixel must make a 121 px title scrollable instead of clipping it.
        assertEquals(listOf(121, 121, 121), nativeFolderTabWidths(360, listOf(121, 120, 120)))
        assertEquals(listOf(120, 120, 120), nativeFolderTabWidths(359, listOf(120, 120, 120)))
    }

    @Test fun addingFoldersOrLongNamesKeepsTheirReadableWidths() {
        assertEquals(listOf(120, 120, 120), nativeFolderTabWidths(360, List(3) { 100 }))
        assertEquals(listOf(100, 100, 100, 100), nativeFolderTabWidths(360, List(4) { 100 }))
        assertEquals(listOf(240, 240), nativeFolderTabWidths(360, listOf(80, 240)))
        assertEquals(emptyList<Int>(), nativeFolderTabWidths(360, emptyList()))
    }
}
