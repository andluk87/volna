package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.robolectric.Robolectric
import org.robolectric.android.controller.ActivityController
import org.junit.Before
import org.junit.After
import androidx.compose.ui.unit.*
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h800dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeMessageBubbleLayoutTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    @Before fun startActivity() { activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible() }
    @After fun closeActivity() { compose.runOnUiThread { activity.pause().stop().destroy() } }
    private fun content(text: String, edited: Boolean = false, timeOnTap: Boolean = false) { compose.runOnUiThread { activity.get().setContent { Bubble(text, edited, timeOnTap) } } }
    private fun screenshot(name: String) {
        compose.runOnUiThread {
            val view = activity.get().window.decorView
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val file = File("build/reports/bubbles/$name.png"); file.parentFile?.mkdirs()
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
    @Composable private fun Bubble(text: String, edited: Boolean = false, timeOnTap: Boolean = false) {
        val context = LocalContext.current
        val voice = remember { NativeVoicePlayback(context) {} }
        val message = VolnaMessage(10, 1, "Иван", text, "2026-10-15T12:30:00Z", false, null, edited = edited)
        Box(Modifier.width(360.dp)) { NativeEmojiProvider { VolnaTheme(NativeAppearance(timeOnTap = timeOnTap)) {
            MessageBubble(message, listOf(message), true, true, false, false, false, false,
                {}, {}, {}, {}, { _, _, _ -> }, {}, voice, "", {}, false, false, 1,
                false, false, {}, {}, {}, false, {}, true)
        } } }
    }
    @Test fun longTextUsesAvailableWidthAndDeliveredTickIsVisible() {
        val text = "Длинное сообщение во время голосового звонка должно занимать нормальную ширину, а галочки должны быть видны."
        content(text)
        val bubble = compose.onNodeWithTag("message-bubble-10").getUnclippedBoundsInRoot()
        val body = compose.onNodeWithText(text).getUnclippedBoundsInRoot()
        assertTrue("bubble width: ${bubble.width}", bubble.width >= 240.dp && bubble.width <= 270.dp)
        assertTrue("body height: ${body.height}", body.height < 120.dp)
        compose.onNodeWithContentDescription("Доставлено").assertIsDisplayed()
        screenshot("long")
    }
    @Test fun timeOnTapDoesNotHideDeliveryTicks() {
        content("Время скрыто, статус виден", timeOnTap = true)
        compose.onNodeWithContentDescription("Доставлено").assertIsDisplayed()
    }
    @Test fun shortEditedMessageKeepsNaturalWidthAndSeparateMetadata() {
        content("Да", edited = true)
        val bounds = compose.onNodeWithTag("message-bubble-10").getUnclippedBoundsInRoot()
        assertTrue("short bubble width: ${bounds.width}", bounds.width >= 96.dp && bounds.width < 220.dp)
        screenshot("short-edited")
        compose.onNodeWithText("Да").assertIsDisplayed()
        compose.onNodeWithContentDescription("Доставлено").assertIsDisplayed()
    }
}
