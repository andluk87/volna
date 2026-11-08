package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
class NativeCallPreparingUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 @Test fun pendingServerRequestShowsProgressAndCanBeCancelled(){
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup();var active by mutableStateOf(true);var phase by mutableStateOf("Подготовка звонка…");var cancellations=0
  try{
   activity.get().setContent{MaterialTheme{if(active)NativeCallPreparingDialog(phase){cancellations++;active=false}}}
   compose.onNodeWithText("Подготовка звонка").assertIsDisplayed();compose.runOnIdle{phase="Нет ответа от сервера. Повторяем запрос…"};compose.onNodeWithText("Нет ответа от сервера. Повторяем запрос…").assertIsDisplayed();compose.onNodeWithText("Отменить").performClick();compose.onNodeWithText("Подготовка звонка").assertDoesNotExist();assertEquals(1,cancellations)
  }finally{activity.pause().stop().destroy()}
 }
}
