package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
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
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],qualifiers="w393dp-h850dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeHomeReferenceUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 private lateinit var server: java.net.ServerSocket
 private lateinit var activity: ActivityController<ComponentActivity>
 private var thirdTab by mutableStateOf("calls")
 private val user=VolnaUser(1,"andrey","Андрей")
 private val chats=(1L..50L).map{VolnaChat(it,if(it==1L)"Избранное" else "Чат $it","","Сообщение $it","2026-10-27T12:00:00Z",if(it%3==0L)2 else 0,it==1L,it)}
 @Before fun start(){
  NativeCredentials.initialize(org.robolectric.RuntimeEnvironment.getApplication())
  android.security.NetworkSecurityPolicy::class.java.getDeclaredMethod("setCleartextTrafficPermitted",Boolean::class.javaPrimitiveType).invoke(android.security.NetworkSecurityPolicy.getInstance(),true)
  server=java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"))
  kotlin.concurrent.thread(isDaemon=true){while(!server.isClosed)try{server.accept().use{socket->val input=socket.getInputStream().bufferedReader();val line=input.readLine().orEmpty();var header=input.readLine();while(!header.isNullOrEmpty())header=input.readLine();val result=when{line.contains("/folders")->"{\"version\":1,\"folders\":[{\"id\":\"all\",\"name\":\"Все чаты\",\"rule\":\"all\",\"chats\":[]},{\"id\":\"work\",\"name\":\"Работа\",\"chats\":[2,3]}]}";line.contains("/users/")->"{\"id\":1,\"name\":\"Андрей\",\"username\":\"andrey\",\"bio\":\"О себе\"}";else->"[]"};val bytes=result.toByteArray();socket.getOutputStream().apply{write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}}}catch(_:java.net.SocketException){}}
  activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
  activity.get().getSharedPreferences("volna-folders-1",0).edit().putBoolean("cloud_migrated",true).commit()
  NativeFolders.save(activity.get(),1,listOf(NativeFolder("all","Все чаты",emptySet(),"all"),NativeFolder("work","Работа",setOf(2,3))))
  compose.runOnUiThread{activity.get().setContent{
   var query by remember{mutableStateOf("")}
   VolnaTheme(NativeAppearance(theme="dark",navigationStyle=NativeNavigationStyle.Bottom.copy(thirdTab=thirdTab))){
    ChatListScreen(user=user,chats=chats,query=query,people=emptyList(),error="",token="test",onQuery={query=it},onSelect={},onChatPreference={_,_,_->},onStartChat={},
     update=null,updateBusy=false,updateStatus="",autoInstallIdle=false,onAutoInstallIdle={},autoUpdateDownload=false,onAutoUpdateDownload={},updateReady=false,onUpdateLater={},onCheckUpdate={},onUpdate={},onScanQr={},onOpenProfile={},onLogout={},onAppearance={},onCommunityEntry={},onSavedMessages={},
     api=NativeApi("http://127.0.0.1:${server.localPort}"),cache=NativeCache(activity.get()),onCall={},onVideo={},onSearchMessage={},onSwitchAccount={},onRetry={},onAppearanceChange={})
   }
  }};compose.waitForIdle()
 }
 @After fun close(){compose.runOnUiThread{activity.pause().stop().destroy()};server.close()}
 private fun screenshot(name:String){compose.runOnUiThread{val view=activity.get().window.decorView;val image=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);view.draw(Canvas(image));File("build/reports/home-reference/$name.png").apply{parentFile!!.mkdirs()}.outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)};image.recycle()}}
 @Test fun profileKeepsNavigationVisibleAndSettingsRemainReachable(){
  screenshot("chats")
  compose.onNodeWithText("Профиль",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithContentDescription("Профиль").assertIsSelected()
  compose.onNodeWithText("Чаты",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("Андрей",useUnmergedTree=true).assertIsDisplayed();screenshot("profile")
  compose.onNodeWithText("Настройки",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithText("Папки с чатами",useUnmergedTree=true).assertExists()
 }
 @Test fun searchIsOpenedFromTheHeaderAndBackRestoresFolders(){
  compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
  compose.onNodeWithContentDescription("Поиск чатов").performClick();compose.waitForIdle()
  compose.onNode(hasSetTextAction()).performTextInput("Чат")
  compose.runOnUiThread{activity.get().onBackPressedDispatcher.onBackPressed()};compose.waitForIdle()
  compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
  compose.onNodeWithText("Все чаты",useUnmergedTree=true).assertIsDisplayed()
 }
 @Test fun contactsLinkOpensCallsWithoutLosingTheChatScroll(){
  compose.onNodeWithTag("chat-folder-list-all").performScrollToIndex(20)
  compose.onNodeWithText("Чат 23",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("Контакты",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithText("Недавние звонки",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithContentDescription("Звонки").assertIsSelected()
  compose.onNodeWithText("Чаты",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithText("Чат 23",useUnmergedTree=true).assertIsDisplayed()
 }
 @Test fun settingsCanStillReplaceCallsInTheBottomNavigation(){
  compose.runOnIdle{thirdTab="profile"};compose.waitForIdle()
  compose.onNodeWithText("Настройки",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithContentDescription("Настройки").assertIsSelected()
  compose.onNodeWithText("Профиль",useUnmergedTree=true).assertIsDisplayed()
 }

 @Test fun archiveBackRestoresTheChatListPosition(){
  compose.onNodeWithTag("chat-folder-list-all").performScrollToIndex(20)
  compose.onNodeWithContentDescription("Действия").performClick()
  compose.onNodeWithText("Ещё",useUnmergedTree=true).performClick()
  compose.onNodeWithText("Архив",useUnmergedTree=true).performClick();compose.waitForIdle()
  compose.onNodeWithContentDescription("Назад").performClick();compose.waitForIdle()
  compose.onNodeWithText("Чат 23",useUnmergedTree=true).assertIsDisplayed()
 }

}
