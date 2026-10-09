package dev.volna.messenger

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.*
import org.junit.Test

class NativeExpressionLogicTest {
    @Test fun backspaceRemovesWholeFamilyEvenIfCursorIsInsideItsSequence() {
        val family = "👨‍👩‍👧"
        val text = "A${family}B"
        val result = NativeEmojiEditing.delete(TextFieldValue(text, TextRange(3)), listOf(1 until 1 + family.length))
        assertEquals("AB", result.text)
        assertEquals(TextRange(1), result.selection)
    }
    @Test fun selectionCannotLeaveHalfOfASkinToneEmoji() {
        val text = "A👍🏽B"
        val result = NativeEmojiEditing.delete(TextFieldValue(text, TextRange(2, 4)), listOf(1 until 5))
        assertEquals("AB", result.text)
        assertEquals(TextRange(1), result.selection)
    }
    @Test fun emojiReplacesSelectionAndPlacesCursorAfterEntireSequence() {
        val result = NativeEmojiEditing.insert(TextFieldValue("Привет мир", TextRange(7, 10)), "👨‍👩‍👧")
        assertEquals("Привет 👨‍👩‍👧", result.text)
        assertEquals(TextRange(result.text.length), result.selection)
        assertNull(result.composition)
    }
    @Test fun insertedTextShiftsCustomEmojiButSelectionChangesDoNot() {
        val e = NativeEmojiEntity("custom", 2, 2)
        assertEquals(listOf(e.copy(start = 4)), NativeEmojiEditing.adjustEntities("Я 👍", "ТыЯ 👍", listOf(e)))
        assertEquals(listOf(e), NativeEmojiEditing.adjustEntities("Я 👍", "Я 👍", listOf(e)))
    }
    @Test fun editingInsideEmojiRemovesItsEntityAndKeepsUnaffectedEntities() {
        val first = NativeEmojiEntity("first", 0, 2)
        val second = NativeEmojiEntity("second", 3, 2)
        val result = NativeEmojiEditing.adjustEntities("👍 👍", "❤️ 👍", listOf(first, second))
        assertEquals(listOf(second), result)
    }
    @Test fun nightScheduleCoversMidnightAndDaytimeWithoutRestart() {
        assertTrue(nativeNightAt(23 * 60, 22 * 60, 7 * 60))
        assertTrue(nativeNightAt(2 * 60, 22 * 60, 7 * 60))
        assertFalse(nativeNightAt(12 * 60, 22 * 60, 7 * 60))
        assertTrue(nativeNightAt(10 * 60, 9 * 60, 17 * 60))
        assertFalse(nativeNightAt(20 * 60, 9 * 60, 17 * 60))
    }
    @Test fun arbitraryMessageGradientsAndAccentStayReadable() {
        val raw = listOf(androidx.compose.ui.graphics.Color.White, androidx.compose.ui.graphics.Color.Black)
        val stops = nativeReadableStops(raw)
        val text = nativeReadableText(stops)
        assertTrue(stops.all { nativeContrast(text, it) >= 4.5f })
        assertTrue(nativeContrast(nativeReadableAccent(androidx.compose.ui.graphics.Color.White, androidx.compose.ui.graphics.Color.White), androidx.compose.ui.graphics.Color.White) >= 3f)
    }
}
