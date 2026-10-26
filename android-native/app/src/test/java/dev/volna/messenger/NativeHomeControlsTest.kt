package dev.volna.messenger

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.Composable
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.robolectric.Robolectric
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.GraphicsMode
import org.junit.Before
import org.junit.After
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w393dp-h850dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeHomeControlsTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    @Before fun startActivity() { activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible() }
    @After fun closeActivity() { compose.runOnUiThread { activity.pause().stop().destroy() } }
    private fun content(block: @Composable () -> Unit) { compose.runOnUiThread { activity.get().setContent(content = block) } }

    @Test fun callsReplaceSettingsInTheBottomBarAndOpenCallHistory() {
        var selected = "chats"
        content {
            VolnaTheme(NativeAppearance(theme = "dark", navigationStyle = NativeNavigationStyle.Bottom.copy(thirdTab = "calls")), updateSystemBars = false) {
                NativeHomeNavigation("chats", null, "", 0, { selected = it }, {})
            }
        }
        compose.onNodeWithText("Настройки").assertDoesNotExist()
        compose.onNodeWithText("Звонки").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals("calls", selected) }
    }
    @Test fun mainMenuOffersThemeSettingsAndExtraExistingActions() {
        val appearance = mutableStateOf(NativeAppearance(theme = "dark"))
        val expanded = mutableStateOf(true)
        var settings = false
        content {
            VolnaTheme(appearance.value, updateSystemBars = false) {
                Box(Modifier.fillMaxSize()) {
                    NativeHomeMenu(expanded.value, appearance.value.theme == "dark", { expanded.value = false },
                        { appearance.value = appearance.value.copy(theme = "light") }, {}, {}, { settings = true }, {}, {}, {}, {}, {})
                }
            }
        }
        compose.onNodeWithText("Дневной режим").assertIsDisplayed()
        compose.onNodeWithText("Создать группу").assertIsDisplayed()
        compose.onNodeWithText("Избранное").assertIsDisplayed()
        compose.onNodeWithText("Создать канал").assertDoesNotExist()
        compose.runOnUiThread {
            val view = android.view.inspector.WindowInspector.getGlobalWindowViews().lastOrNull { it.javaClass.name.contains("PopupLayout") }
            if (view != null && view.width > 0 && view.height > 0) {
                val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                view.draw(Canvas(bitmap))
                val screenshot = File("build/reports/home-controls/menu.png").apply { parentFile!!.mkdirs() }
                screenshot.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
        }
        compose.onNodeWithText("Ещё").performClick()
        compose.onNodeWithText("Создать канал").assertExists()
        compose.onNodeWithText("Настройки").performScrollTo().performClick()
        compose.runOnIdle { assertTrue(settings); expanded.value = true }
        compose.onNodeWithText("Дневной режим").performClick()
        compose.runOnIdle { assertEquals("light", appearance.value.theme) }
    }
    @Test fun incomingTextRequiresAChosenRecipientAndCanBeCancelledWithoutSending() {
        var dismissed = false
        val share = NativeIncomingShare("ui-test", "https://example.org/shared", emptyList())
        content {
            VolnaTheme(NativeAppearance(), updateSystemBars = false) {
                NativeIncomingShareDialog(share, listOf(VolnaChat(1, "Получатель", "", "", "", 0, false, 2)), "test", "Аккаунт",
                    NativeApi("https://example.invalid"), false, { dismissed = true }, { _, _, _ -> fail("unexpected attachment send") }, { _, _ -> fail("unexpected automatic send") })
            }
        }
        compose.onNodeWithText("Отправить").assertIsNotEnabled()
        compose.onNodeWithText("Получатель").performClick()
        compose.onNodeWithText("Отмена").performClick()
        compose.runOnIdle { assertTrue(dismissed) }
    }
}
