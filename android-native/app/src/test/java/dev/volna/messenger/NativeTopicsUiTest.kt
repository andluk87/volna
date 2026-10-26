package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import java.net.ServerSocket
import java.net.SocketException
import kotlin.concurrent.thread
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h800dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeTopicsUiTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    private lateinit var server: ServerSocket
    private val selected = CopyOnWriteArrayList<Long>()
    private val appearance = mutableStateOf(NativeAppearance(theme="dark"))
    private val writes = CopyOnWriteArrayList<JSONObject>()
    private fun topic(id: Int, title: String, icon: String, last: Int) = JSONObject().put("id", id).put("name", title).put("icon", icon).put("last_id", last).put("last_text", "Макеты обновлены").put("last_sender", "Анна").put("last_at", "2026-10-26T12:45:00Z").put("unread_count", 4).put("can_manage", true).put("notification_mode", "all").put("link", "/app?chat=$id")
    @Before fun start() {
        NativeCredentials.initialize(org.robolectric.RuntimeEnvironment.getApplication())
        // The fixture is loopback-only; the production manifest continues to require HTTPS.
        android.security.NetworkSecurityPolicy::class.java.getDeclaredMethod("setCleartextTrafficPermitted", Boolean::class.javaPrimitiveType).invoke(android.security.NetworkSecurityPolicy.getInstance(), true)
        server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true, name = "topic-api-fixture") { while (!server.isClosed) try {
            server.accept().use { socket ->
                val input = socket.getInputStream().buffered()
                fun line(): String { val bytes=java.io.ByteArrayOutputStream();while(true){val n=input.read();if(n<0||n==10)break;if(n!=13)bytes.write(n)};return bytes.toString("UTF-8") }
                val requestLine=line();var length=0;while(true){val header=line();if(header.isEmpty())break;if(header.startsWith("Content-Length:",true))length=header.substringAfter(':').trim().toInt()}
                val body=ByteArray(length);var offset=0;while(offset<body.size){val n=input.read(body,offset,body.size-offset);if(n<0)break;offset+=n}
                val result = if (requestLine.startsWith("GET ")) JSONObject().put("enabled", true).put("role", "owner").put("can_create", true).put("can_manage", true).put("member_count", 124).put("general", topic(1,"Общая","💬",10).put("general",true)).put("topics",JSONArray().put(topic(2,"Дизайн","🎨",20)).put(topic(3,"Разработка","💻",15))).put("next_cursor",JSONObject.NULL)
                    else { val data=JSONObject(body.toString(Charsets.UTF_8));writes.add(data);topic(4,data.optString("name"),data.optString("icon"),0) }
                val bytes=result.toString().toByteArray();socket.getOutputStream().apply{write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
            }
        } catch (problem: SocketException) { if (!server.isClosed) throw problem } }
        val api=NativeApi("http://127.0.0.1:${server.localPort}")
        assertEquals(124,api.topics("test-token",1,paged=true).getInt("member_count"))
        activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        compose.runOnUiThread { activity.get().setContent { NativeEmojiProvider { VolnaTheme(appearance.value) {
            NativeTopicsDialog(VolnaChat(1,"Команда проекта","","","",0,false,0,kind="group",role="owner",topicsEnabled=true),"test-token",api,{}, {},{ id, _ -> selected.add(id) })
        } } } }
        compose.onNodeWithText("Команда проекта").assertExists()
        try { compose.waitUntil(15000) { compose.onAllNodesWithText("Дизайн").fetchSemanticsNodes().isNotEmpty() } }
        catch(problem:Exception){
            fun dump(node:androidx.compose.ui.semantics.SemanticsNode){println(node.config.toString());node.children.forEach{dump(it)}}
            compose.onAllNodes(isRoot()).fetchSemanticsNodes().forEach{dump(it)};throw problem
        }
    }
    @After fun close() { if(::activity.isInitialized)compose.runOnUiThread { activity.pause().stop().destroy() }; if(::server.isInitialized)server.close() }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        compose.runOnUiThread {
            val view=org.robolectric.shadows.ShadowDialog.getShownDialogs().lastOrNull{it.isShowing}?.window?.decorView ?: activity.get().window.decorView
            val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888);view.draw(Canvas(bitmap))
            val file=File("build/reports/topics/$name.png");file.parentFile?.mkdirs();file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        }
    }
    @Test fun listShowsPreviewAndLongPressActionsWithoutCardButtons() {
        compose.onNodeWithText("124 участников").assertExists();compose.onAllNodesWithText("Анна: Макеты обновлены").assertCountEquals(3)
        compose.onNodeWithText("Действия").assertDoesNotExist();screenshot("list-dark")
        compose.onNodeWithText("Дизайн").performTouchInput{longClick()}
        compose.onNodeWithText("Отметить как прочитанную").assertExists();compose.onNodeWithText("Без звука").assertExists();compose.onNodeWithText("Изменить тему").assertExists()
        screenshot("actions-dark");compose.onNodeWithText("Открыть тему").performClick();assertEquals(listOf(2L),selected.toList())
    }
    @Test fun lightThemeKeepsTopicListAndSearchUsable() {
        compose.runOnUiThread { appearance.value = NativeAppearance(theme="light") }
        compose.onNodeWithText("Дизайн").assertExists();screenshot("list-light")
        compose.onNodeWithContentDescription("Поиск по группе").performClick()
        compose.onNodeWithText("Найти тему").assertExists()
    }
    @Test fun creationUsesEmojiAndOpensReturnedTopic() {
        compose.onNodeWithText("Создать тему").performClick();compose.onNodeWithText("Новая тема").assertExists()
        compose.onNodeWithText("Название темы").performTextInput("Новая тема дизайна")
        compose.onNodeWithText("Выбрать эмодзи").performClick();compose.onNodeWithText("Значок темы").assertExists()
        compose.onNodeWithText("Найти эмодзи").performTextInput("ракета")
        val rocket=hasText("🚀") and SemanticsMatcher.expectValue(SemanticsProperties.Role,Role.Button)
        compose.waitUntil(10000){compose.onAllNodes(rocket).fetchSemanticsNodes().isNotEmpty()}
        compose.onNode(rocket).performClick();screenshot("create-dark")
        compose.onNodeWithText("Создать",useUnmergedTree=true).performClick()
        compose.waitUntil(10000){selected.contains(4)};assertEquals("🚀",writes.single().getString("icon"));assertEquals("Новая тема дизайна",writes.single().getString("name"))
    }
}
