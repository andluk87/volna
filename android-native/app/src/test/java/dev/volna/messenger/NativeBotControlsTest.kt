package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.unit.dp
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeBotControlsTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    @Before fun startActivity() { activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible() }
    @After fun closeActivity() { compose.runOnUiThread { activity.pause().stop().destroy() } }
    private fun show(deleted: Boolean = false) {
        val message = VolnaMessage(40, 20, "Бот", "Выберите", "2026-10-17T12:00:00Z", deleted, null,
            botButtons = listOf(listOf(NativeBotButton("catalog", "Каталог"), NativeBotButton("help", "Помощь"))))
        compose.runOnUiThread { activity.get().setContent {
            NativeEmojiProvider { VolnaTheme(NativeAppearance()) {
                Box(Modifier.width(300.dp)) { NativeBotButtons(message, "test-session", NativeApi("https://volna.example.com")) }
            } }
        } }
    }
    @Test fun buttonsAreVisibleAndFitOnMobile() {
        show()
        compose.onNodeWithText("Каталог").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Помощь").assertIsDisplayed().assertHasClickAction()
        val catalog = compose.onNodeWithText("Каталог").getUnclippedBoundsInRoot()
        val help = compose.onNodeWithText("Помощь").getUnclippedBoundsInRoot()
        assertTrue(catalog.right <= help.left)
        assertTrue(help.right <= 300.dp)
    }
    @Test fun deletedMessageHasNoActionableButtons() {
        show(deleted = true)
        compose.onNodeWithText("Каталог").assertDoesNotExist()
        compose.onNodeWithText("Помощь").assertDoesNotExist()
    }
}
