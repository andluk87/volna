package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.net.ServerSocket

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],qualifiers="w412dp-h915dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeTelegramReferenceTest {
 @get:Rule val compose=createEmptyComposeRule()
 private lateinit var activity:ActivityController<ComponentActivity>
 private lateinit var server:ServerSocket
 private val user=VolnaUser(1,"andrey","Андрей",phone="+79000000001",online=true)
 private val contacts=JSONArray((2..20).map{ id -> JSONObject().put("contact_id","contact-$id").put("display_name","Контакт $id").put("custom_name","Контакт $id").put("phone_numbers",JSONArray().put("+790000000$id")).put("user",JSONObject().put("id",id).put("name","Контакт $id").put("username","contact$id").put("online",id%2==0)) })
 private val book get()=JSONObject().put("contacts",contacts).put("enabled",false).put("epoch",1).put("version",1)
 private val post=JSONObject().put("id",1).put("user_id",1).put("text","Моя первая публикация в VLN").put("created",1793181600000L).put("archived",0)
 private val archive=JSONObject().put("id",2).put("user_id",1).put("text","Публикация в личном архиве").put("created",1793095200000L).put("archived",1)
 @Before fun start(){
  NativeCredentials.initialize(RuntimeEnvironment.getApplication())
  android.security.NetworkSecurityPolicy::class.java.getDeclaredMethod("setCleartextTrafficPermitted",Boolean::class.javaPrimitiveType).invoke(android.security.NetworkSecurityPolicy.getInstance(),true)
  server=ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"))
  kotlin.concurrent.thread(isDaemon=true){while(!server.isClosed)try{server.accept().use{socket->
   val input=socket.getInputStream().bufferedReader();val line=input.readLine().orEmpty();var header=input.readLine();while(!header.isNullOrEmpty())header=input.readLine()
   val response=when{
    line.contains("/contacts/book")->book.toString()
    line.contains("/folders")->JSONObject().put("version",1).put("folders",JSONArray().put(JSONObject().put("id","all").put("name","Все чаты").put("rule","all").put("chats",JSONArray())).put(JSONObject().put("id","work").put("name","Работа").put("chats",JSONArray().put(2).put(3)))).toString()
    line.contains("/users/1/posts")->JSONArray().put(if(line.contains("archive=1"))archive else post).toString()
    line.contains("/users/1")->JSONObject().put("id",1).put("name",user.name).put("username",user.username).put("phone",user.phone).put("bio","На связи в VLN").toString()
    line.contains("/calls/history")->JSONArray((1..8).map{id->JSONObject().put("id","call-$id").put("chat_id",id+1).put("peer",JSONObject().put("id",id+1).put("name","Контакт ${id+1}").put("username","contact${id+1}")).put("incoming",id%2==0).put("created",1793181600000L-id*60000).put("ended",1793181600000L).put("status",if(id==2)"missed" else "ended").put("duration",if(id==2)0 else 35)}).toString()
    else->"[]"
   };val bytes=response.toByteArray();socket.getOutputStream().apply{write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
  }}catch(_:java.net.SocketException){}}
  activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
  NativeContactBook(activity.get(),1).save(book)
  activity.get().getSharedPreferences("volna-folders-1",0).edit().putBoolean("cloud_migrated",true).commit()
  NativeFolders.save(activity.get(),1,listOf(NativeFolder("all","Все чаты",emptySet(),"all"),NativeFolder("work","Работа",setOf(2,3))))
  val chats=(2L..40L).map{id->VolnaChat(id,"Контакт $id","contact$id","Сообщение от собеседника","2026-10-29T01:00:00Z",if(id%3==0L)2 else 0,false,id,peerOnline=id%2==0L)}
  compose.runOnUiThread{activity.get().setContent{var query by remember{mutableStateOf("")};NativeEmojiProvider{VolnaTheme(NativeAppearance(theme="dark")){
   ChatListScreen(user=user,chats=chats,query=query,people=emptyList(),error="",token="test",onQuery={query=it},onSelect={},onChatPreference={_,_,_->},onStartChat={},
    update=null,updateBusy=false,updateStatus="",autoInstallIdle=false,onAutoInstallIdle={},autoUpdateDownload=false,onAutoUpdateDownload={},updateReady=false,onUpdateLater={},onCheckUpdate={},onUpdate={},onScanQr={},onOpenProfile={},onLogout={},onAppearance={},onCommunityEntry={},onSavedMessages={},
    api=NativeApi("http://127.0.0.1:${server.localPort}"),cache=NativeCache(activity.get()),onCall={},onVideo={},onSearchMessage={},onSwitchAccount={},onRetry={},onAppearanceChange={})
  }}}}
 }
 @After fun close(){compose.runOnUiThread{activity.pause().stop().destroy()};server.close()}
 private var frame=0
 private fun shot(name:String){compose.waitForIdle();compose.runOnUiThread{
  val base=activity.get().window.decorView;val bitmap=Bitmap.createBitmap(base.width,base.height,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);base.draw(canvas)
  org.robolectric.shadows.ShadowDialog.getShownDialogs().filter{it.isShowing}.forEach{dialog->dialog.window?.decorView?.let{view->val xy=IntArray(2);view.getLocationOnScreen(xy);canvas.save();canvas.translate(xy[0].toFloat(),xy[1].toFloat());view.draw(canvas);canvas.restore()}}
  val size=if(base.width<400)"360" else "412";val file=File("build/reports/reference86/$size/${frame++.toString().padStart(2,'0')}-$name.png");file.parentFile!!.mkdirs();file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
 }}
 private fun tab(name:String){compose.onAllNodesWithText(name,useUnmergedTree=true).onLast().performClick();compose.waitForIdle()}
 private fun waitText(text:String){compose.waitUntil(10000){compose.onAllNodesWithText(text,useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty()}}
 private fun scenario(){
  compose.waitForIdle();if(compose.onAllNodesWithText("Готово").fetchSemanticsNodes().isNotEmpty()){compose.onNodeWithText("Готово").performClick();compose.waitForIdle()}
  shot("chats");compose.onNodeWithText("Контакт 4",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithTag("chat-folder-list-all").performScrollToNode(hasText("Контакт 20"));compose.onNodeWithText("Контакт 20",useUnmergedTree=true).assertIsDisplayed()
  tab("Контакты");waitText("Сортировка по имени");shot("contacts")
  compose.onNodeWithText("Сортировка по имени").performClick();compose.onNodeWithText("По времени захода").performClick();compose.onNodeWithText("Сортировка по времени захода").assertIsDisplayed()
  tab("Звонки");waitText("Контакт 2");shot("calls")
  tab("Профиль");waitText("Моя первая публикация в VLN");shot("profile")
  compose.onNodeWithText("Выбрать фото",useUnmergedTree=true).assertIsDisplayed();compose.onNodeWithText("Изменить",useUnmergedTree=true).assertIsDisplayed()
  compose.onNodeWithText("Архив публикаций",useUnmergedTree=true).performClick();waitText("Публикация в личном архиве");shot("archive")
  compose.onNodeWithText("Публикации",useUnmergedTree=true).performClick();waitText("Добавить публикацию");compose.onNodeWithText("Добавить публикацию").performClick();waitText("Новая публикация");compose.onNodeWithText("Опубликовать").assertIsNotEnabled();shot("new-post")
  compose.onNodeWithText("Отмена").performClick();compose.waitForIdle()
  compose.onNodeWithText("Настройки",useUnmergedTree=true).performClick();waitText("Аккаунт");shot("settings")
  compose.runOnUiThread{activity.get().onBackPressedDispatcher.onBackPressed()};waitText("Моя первая публикация в VLN")
  tab("Чаты");shot("back-to-chats");compose.onNodeWithText("Контакт 20",useUnmergedTree=true).assertIsDisplayed()
 }
 @Test @Config(qualifiers="w360dp-h640dp-mdpi") fun narrowPhoneScreensAndNavigation(){scenario()}
 @Test fun largePhoneScreensAndNavigation(){scenario()}
}
