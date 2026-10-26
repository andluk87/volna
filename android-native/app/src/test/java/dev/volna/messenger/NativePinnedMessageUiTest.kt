package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.unit.dp
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h800dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativePinnedMessageUiTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    private val jumps = mutableListOf<Long>()
    private var allPins = 0
    private val voice = VolnaMessage(42, 1, "Автор", "", "2026-10-27T00:00:00Z", false, "Голосовое-1791466172348.m4a",
        attachmentId = "a".repeat(48), attachmentMime = "audio/mp4", pinned = true)
    @Before fun start() { activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible() }
    @After fun close() { compose.runOnUiThread { activity.pause().stop().destroy() } }
    private fun content(dark: Boolean) { compose.runOnUiThread { activity.get().setContent {
        VolnaTheme(NativeAppearance(theme = if (dark) "dark" else "light"), updateSystemBars = false) {
            Box(Modifier.width(400.dp).background(Ink)) { NativePinnedMessage(voice, { jumps.add(it) }, { allPins++ }) }
        }
    } } }
    private fun screenshot(name: String) { compose.runOnUiThread {
        val view = activity.get().window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        val file = File("build/reports/pinned-preview/$name.png").apply { parentFile!!.mkdirs() }
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    } }
    @Test fun lightVoicePinShowsTheMessageTypeAndKeepsBothNavigationActions() {
        content(false)
        compose.onNodeWithText("Закреплённое сообщение").assertIsDisplayed()
        compose.onNodeWithText("Голосовое сообщение").assertIsDisplayed()
        compose.onNodeWithText(voice.attachmentName!!).assertDoesNotExist()
        screenshot("light")
        compose.onNodeWithText("Голосовое сообщение").performClick()
        compose.runOnIdle { assertEquals(listOf(42L), jumps) }
        compose.onNodeWithContentDescription("Все закреплённые сообщения").performClick()
        compose.runOnIdle { assertEquals(1, allPins); assertEquals(listOf(42L), jumps) }
    }
    @Test fun darkVoicePinUsesTheSameReadablePreview() {
        content(true)
        compose.onNodeWithText("Голосовое сообщение").assertIsDisplayed()
        compose.onNodeWithText(voice.attachmentName!!).assertDoesNotExist()
        screenshot("dark")
    }
}
