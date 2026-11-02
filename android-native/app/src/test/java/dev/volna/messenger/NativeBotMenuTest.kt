package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeBotMenuTest {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun choosingAnItemExecutesTheExactCommandAndMenusFollowTheBot(){
        val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        var commands by mutableStateOf(listOf(NativeBotCommand("/calllog","Журнал на 24 часа"),NativeBotCommand("/revoke","Отозвать доступ")))
        val sent=mutableListOf<String>()
        activity.get().setContent { MaterialTheme { NativeBotMenu(commands,true){sent.add(it)} } }
        compose.onNodeWithText("Меню").performClick();compose.onNodeWithText("/calllog").performClick()
        compose.runOnIdle{assertEquals(listOf("/calllog"),sent)}
        compose.onNodeWithText("/calllog").assertDoesNotExist()
        compose.runOnIdle{commands=listOf(NativeBotCommand("/status","Другой бот"))}
        compose.onNodeWithText("Меню").performClick();compose.onNodeWithText("/calllog").assertDoesNotExist();compose.onNodeWithText("/status").performClick()
        compose.runOnIdle{assertEquals(listOf("/calllog","/status"),sent);commands=emptyList()}
        compose.onNodeWithText("Меню").assertDoesNotExist();activity.pause().stop().destroy()
    }
    @Test fun disabledMenuCannotSendWhileAMessageIsPending(){
        val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        val sent=mutableListOf<String>()
        activity.get().setContent { MaterialTheme { NativeBotMenu(listOf(NativeBotCommand("/help","Команды")),false){sent.add(it)} } }
        compose.onNodeWithText("Меню").assertIsNotEnabled();compose.runOnIdle{assertTrue(sent.isEmpty())};activity.pause().stop().destroy()
    }
}
