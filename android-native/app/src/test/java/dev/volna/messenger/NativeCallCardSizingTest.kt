package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h850dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeCallCardSizingTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    @Before fun start() { activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible() }
    @After fun close() { compose.runOnUiThread { activity.pause().stop().destroy() } }
    private fun content(incoming: Boolean = true, width: Int = 373, scale: Float = 1f) {
        compose.runOnUiThread { activity.get().setContent {
            VolnaTheme(NativeAppearance(theme = "dark", textScale = scale)) {
                Box(Modifier.width(width.dp)) {
                    NativeChatCallCard(VolnaCallRecord("sizing", 1, null, incoming, 0, "cancelled", 0, false), true) {}
                }
            }
        } }
    }
    private fun layout(title: String): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(title, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        return layouts.single()
    }
    @Test fun missedCallFitsOneLineAtReferencePhoneWidth() {
        content()
        val card = compose.onNodeWithTag("call-card-sizing").getUnclippedBoundsInRoot()
        assertEquals(270.dp, card.width)
        assertTrue("compact call height: $card", card.height in 54.dp..60.dp)
        assertEquals(1, layout("Пропущенный звонок").lineCount)
        assertFalse(layout("Пропущенный звонок").hasVisualOverflow)
        compose.runOnUiThread {
            val view = activity.get().window.decorView
            val bitmap = android.graphics.Bitmap.createBitmap(view.width, view.height, android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            val file = java.io.File("build/reports/bubbles/call-reference.png"); file.parentFile.mkdirs()
            file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
    @Test fun outgoingCallUsesSameSizeAndRightAlignment() {
        content(incoming = false)
        val card = compose.onNodeWithTag("call-card-sizing").getUnclippedBoundsInRoot()
        assertEquals(373.dp, card.right)
        assertEquals(270.dp, card.width)
        assertEquals(1, layout("Отменённый звонок").lineCount)
    }
    @Test fun largeTextAndNarrowScreenWrapWithoutClipping() {
        content(width = 240, scale = 1.5f)
        val card = compose.onNodeWithTag("call-card-sizing").getUnclippedBoundsInRoot()
        assertTrue(card.width <= 240.dp)
        val title = layout("Пропущенный звонок")
        assertTrue(title.lineCount > 1)
        assertFalse(title.hasVisualOverflow)
        compose.onNodeWithContentDescription("Повторить звонок").assertIsDisplayed()
    }
}
