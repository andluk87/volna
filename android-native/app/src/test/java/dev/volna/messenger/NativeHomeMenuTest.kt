package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.IconButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.unit.*
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
@Config(sdk=[35],qualifiers="w400dp-h800dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeHomeMenuTest {
    @get:Rule val compose=createEmptyComposeRule()
    private lateinit var activity:ActivityController<ComponentActivity>
    private val actions=mutableListOf<String>()
    @Before fun start(){activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()}
    @After fun close(){compose.runOnUiThread { activity.pause().stop().destroy() }}
    private fun content(dark:Boolean=true){compose.runOnUiThread {activity.get().setContent {
        var expanded by remember { mutableStateOf(true) }
        var theme by remember { mutableStateOf(if(dark)"dark" else "light") }
        NativeEmojiProvider { VolnaTheme(NativeAppearance(theme=theme)) {
            Box(Modifier.fillMaxSize().background(Ink)) {Box(Modifier.align(Alignment.TopEnd).padding(16.dp)) {
                IconButton(onClick={expanded=true}) { NativeText("⋮") }
                NativeHomeMenu(expanded,{expanded=false},{next->theme=if(next)"dark" else "light";actions.add(theme)},
                    {actions.add("group")},{actions.add("saved")},{actions.add("settings")},{actions.add("new")},
                    {actions.add("channel")},{actions.add("join")},{actions.add("archive")},{actions.add("accounts")})
            }}
        }}
    }}}
    private fun screenshot(name:String){compose.waitForIdle();compose.runOnUiThread {
        val cls=Class.forName("android.view.WindowManagerGlobal"); val instance=cls.getMethod("getInstance").invoke(null)
        val names=cls.getMethod("getViewRootNames").invoke(instance) as Array<*>
        val view=names.map {cls.getMethod("getRootView",String::class.java).invoke(instance,it) as View}.last()
        val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);view.draw(Canvas(bitmap))
        val file=File("build/reports/home-menu/$name.png");file.parentFile?.mkdirs();file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
    }}
    @Test fun mainMenuIsCompactAndSettingsWorks(){
        content();compose.onNodeWithText("Дневной режим").assertIsDisplayed();compose.onNodeWithText("Новый чат").assertDoesNotExist()
        val bounds=compose.onNode(isPopup()).getUnclippedBoundsInRoot();assertEquals(216f,bounds.width.value,1f);assertTrue(bounds.height<280.dp)
        screenshot("dark");compose.onNodeWithText("Настройки").performClick();assertEquals(listOf("settings"),actions);compose.onNodeWithText("Ещё").assertDoesNotExist()
    }
    @Test fun secondaryActionsStayAvailable(){content();compose.onNodeWithText("Ещё").performClick();compose.onNodeWithText("Назад").assertIsDisplayed();compose.onNodeWithText("Войти по приглашению").assertIsDisplayed();screenshot("more-dark");compose.onNodeWithText("Аккаунты").performClick();assertEquals(listOf("accounts"),actions)}
    @Test fun themeToggleChoosesOppositeTheme(){content();compose.onNodeWithText("Дневной режим").performClick();assertEquals(listOf("light"),actions)}
    @Test fun lightMenuUsesNightAction(){content(false);compose.onNodeWithText("Ночной режим").assertIsDisplayed();screenshot("light");compose.onNodeWithText("Создать группу").performClick();assertEquals(listOf("group"),actions)}
}
