package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
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
    private fun content(text: String, edited: Boolean = false, timeOnTap: Boolean = false, reactions: List<VolnaReaction> = emptyList()) { compose.runOnUiThread { activity.get().setContent { Bubble(text, edited, timeOnTap, reactions) } } }
    private fun screenshot(name: String, dialog: Boolean = false) {
        compose.runOnUiThread {
            val view = (if (dialog) org.robolectric.shadows.ShadowDialog.getShownDialogs().lastOrNull { it.isShowing }?.window?.decorView else null) ?: activity.get().window.decorView
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val file = File("build/reports/bubbles/$name.png"); file.parentFile?.mkdirs()
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }
    @Composable private fun Bubble(text: String, edited: Boolean = false, timeOnTap: Boolean = false, reactions: List<VolnaReaction> = emptyList()) {
        val context = LocalContext.current
        val voice = remember { NativeVoicePlayback(context) {} }
        val message = VolnaMessage(10, 1, "Иван", text, "2026-10-15T12:30:00Z", false, null, edited = edited, reactions = reactions)
        Box(Modifier.width(360.dp)) { NativeEmojiProvider { VolnaTheme(NativeAppearance(theme = "dark", timeOnTap = timeOnTap)) {
            MessageBubble(message, listOf(message), true, true, false, false, false, false,
                {}, {}, {}, {}, { _, _, _ -> }, {}, voice, "", {}, false, false, 1,
                false, false, {}, {}, {}, false, {}, true)
        } } }
    }
    @Test fun standaloneEmojiIsLargeAndStampStaysVisible() {
        content("😁")
        val body = compose.onNodeWithText("😁", useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertTrue("large emoji: $body", body.height >= 96.dp)
        compose.onNodeWithContentDescription("Доставлено").assertIsDisplayed()
        val stamp = compose.onNodeWithContentDescription("Доставлено", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val bubble = compose.onNodeWithTag("message-bubble-10").getUnclippedBoundsInRoot()
        assertTrue("stamp belongs below emoji: $body $stamp", stamp.top >= body.bottom)
        assertTrue("no extra timestamp column: $bubble", bubble.width <= 104.dp)
        screenshot("standalone-emoji")
    }
    @Test fun mixedTextKeepsNormalSize() {
        content("Привет 😁")
        val body = compose.onNodeWithText("Привет 😁", useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertTrue("inline emoji must stay small: $body", body.height < 40.dp)
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
    @Test fun shortPlainMessageSharesLineWithTime() {
        content("хорошо")
        val body = compose.onNodeWithText("хорошо", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val tick = compose.onNodeWithContentDescription("Доставлено", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val bubble = compose.onNodeWithTag("message-bubble-10").getUnclippedBoundsInRoot()
        assertTrue("time must sit beside the text: $body $tick", tick.top < body.bottom && tick.left >= body.right)
        assertTrue("compact width ${bubble.width}", bubble.width < 180.dp)
        screenshot("single-line")
    }
    @Test fun reactionsWrapWithVisibleTime() {
        content("И хлеб", reactions = listOf("❤️", "👍", "🔥", "👏", "😎", "🎉").map { VolnaReaction(it, 1, "Иван") })
        compose.onNodeWithText("И хлеб").assertIsDisplayed()
        val chips = compose.onNodeWithTag("message-reactions-10", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val tick = compose.onNodeWithContentDescription("Доставлено", useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertTrue("reactions and stamp overlap: $chips $tick", chips.right <= tick.left)
        assertTrue("footer bottom: $chips $tick", tick.bottom <= chips.bottom + 4.dp)
        screenshot("reactions")
    }

    @Test fun folderBarMatchesRoundedSegmentLayout() {
        compose.runOnUiThread { activity.get().setContent {
            NativeEmojiProvider { VolnaTheme(NativeAppearance(theme = "dark")) {
                val folders = listOf(NativeFolder("a", "РРЦПД", setOf(1)), NativeFolder("b", "ДЦР", setOf(2)), NativeFolder("c", "РТК", setOf(3)))
                val chats = (1L..3L).map { VolnaChat(it, "Чат", "", "", "", 0, false, it) }
                Column(Modifier.width(400.dp).background(Ink).padding(vertical = 8.dp)) {
                    NativeFolderTabs(folders, chats, "folder:a") {}
                    NativeHomeNavigation("chats", null, "", 73, {}, {}, Modifier.padding(horizontal = 28.dp, vertical = 16.dp))
                    NativeRecordingWave(List(28) { index -> listOf(.12f, .3f, .7f, .95f, .6f, .35f, .15f)[index % 7] }, Modifier.width(400.dp).padding(horizontal = 24.dp, vertical = 12.dp))
                }
            } }
        } }
        compose.onNodeWithText("РРЦПД").assertIsDisplayed()
        compose.onNodeWithText("Все чаты").assertIsDisplayed()
        screenshot("folders")
    }

    @Test fun navigationControlsPersistAndResetOnlyTheirOwnSettings() {
        val prefs = activity.get().getSharedPreferences("navigation-ui", 0)
        prefs.edit().clear().commit()
        compose.runOnUiThread { activity.get().setContent {
            var value by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(NativeAppearance(theme = "dark", radius = 22,
                foldersStyle = NativeNavigationStyle.Folders.copy(height = 56), navigationStyle = NativeNavigationStyle.Bottom.copy(radius = 14))) }
            VolnaTheme(value) { NativeNavigationCustomization(value, { value = it; it.save(prefs) }) }
        } }
        screenshot("navigation-settings")
        compose.onNodeWithText("Нижняя навигация").performClick()
        compose.onNodeWithContentDescription("Скругление").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetProgress) { it(8f) }
        compose.onNodeWithContentDescription("Показывать подписи").performScrollTo().performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(8, NativeAppearance.load(prefs).navigationStyle.radius)
            org.junit.Assert.assertFalse(NativeAppearance.load(prefs).navigationStyle.labels)
        }
        compose.onNodeWithContentDescription("Чаты").assertIsDisplayed()
        compose.onNodeWithText("Подложка").performScrollTo().performClick()
        compose.onNode(hasSetTextAction()).performScrollTo().performTextReplacement("#203040")
        compose.onNodeWithText("Готово").performScrollTo().performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0xFF203040L, NativeAppearance.load(prefs).navigationStyle.surface) }
        screenshot("navigation-controls", dialog = true)
        compose.onNodeWithText("Сбросить нижнюю навигацию").performScrollTo().performClick()
        compose.runOnIdle {
            val saved = NativeAppearance.load(prefs)
            org.junit.Assert.assertEquals(NativeNavigationStyle.Bottom, saved.navigationStyle)
            org.junit.Assert.assertEquals(56, saved.foldersStyle.height)
            org.junit.Assert.assertEquals(22, saved.radius)
        }
        compose.onNodeWithContentDescription("Назад").performClick()
        compose.onNodeWithText("Сбросить папки и навигацию").performClick()
        compose.runOnIdle {
            val saved = NativeAppearance.load(prefs)
            org.junit.Assert.assertEquals(NativeNavigationStyle.Folders, saved.foldersStyle)
            org.junit.Assert.assertEquals(NativeNavigationStyle.Bottom, saved.navigationStyle)
            org.junit.Assert.assertEquals(22, saved.radius)
        }
    }

}
