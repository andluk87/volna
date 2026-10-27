package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import androidx.compose.ui.unit.dp

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],qualifiers="w393dp-h850dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeFolderPagerUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 private lateinit var activity: ActivityController<ComponentActivity>
 private val chats=(1L..50L).map{VolnaChat(it,"Чат $it","","","",0,false,it)}
 private var selected by mutableStateOf("all")
 private var folders by mutableStateOf(listOf(NativeFolder("all","Все чаты",emptySet(),"all"),NativeFolder("work","Работа",setOf(1,2)),NativeFolder("friends","Друзья",setOf(3,4))))
 @Before fun start(){activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible();compose.runOnUiThread{activity.get().setContent{VolnaTheme(NativeAppearance(theme="dark")){NativeFolderPager(folders,chats,selected,{selected=it},Modifier.fillMaxSize()){key->LazyColumn(Modifier.fillMaxSize().testTag("list-$key")){items((1..50).toList(),key={it}){NativeText("$key строка $it",Modifier.fillMaxWidth().height(60.dp))}}}}}};compose.waitForIdle()}
 @After fun close(){compose.runOnUiThread{activity.pause().stop().destroy()}}
 @Test fun swipeAndTabClickChangeTheSameSelectedFolder(){
  compose.onNodeWithTag("folder-pager").performTouchInput{swipeLeft()};compose.waitForIdle();compose.runOnIdle{assertEquals("folder:work",selected)}
  compose.onNodeWithText("Друзья",useUnmergedTree=true).performClick();compose.waitForIdle();compose.runOnIdle{assertEquals("folder:friends",selected)}
  compose.onNodeWithTag("folder-pager").performTouchInput{swipeRight()};compose.waitForIdle();compose.runOnIdle{assertEquals("folder:work",selected)}
 }
 @Test fun eachFolderRestoresItsOwnScrollPosition(){
  compose.onNodeWithTag("list-all").performScrollToIndex(20);compose.onNodeWithText("all строка 21").assertIsDisplayed()
  compose.onNodeWithText("Работа",useUnmergedTree=true).performClick();compose.waitForIdle();compose.onNodeWithTag("list-folder:work").performScrollToIndex(10)
  compose.onNodeWithText("Все чаты",useUnmergedTree=true).performClick();compose.waitForIdle();compose.onNodeWithText("all строка 21").assertIsDisplayed()
 }
 @Test fun folderUpdateKeepsTheSelectedKey(){
  compose.onNodeWithText("Друзья",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.runOnIdle{folders=listOf(folders[0],folders[2],folders[1])};compose.waitForIdle();compose.runOnIdle{assertEquals("folder:friends",selected)}
 }
}
