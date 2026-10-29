package dev.volna.messenger

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner
import org.json.JSONObject
import org.json.JSONArray
import java.net.ServerSocket

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35], application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeCallPrivacyUiTest {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun privacyChangesAreSavedAndBlockedCallsCanBeUnblocked() {
        NativeCredentials.initialize(RuntimeEnvironment.getApplication())
        android.security.NetworkSecurityPolicy::class.java.getDeclaredMethod("setCleartextTrafficPermitted",Boolean::class.javaPrimitiveType).invoke(android.security.NetworkSecurityPolicy.getInstance(),true)
        val server=ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"))
        val policy=java.util.concurrent.atomic.AtomicReference(JSONObject().put("allow_calls","everyone").put("relay_only",false).put("blocked",JSONArray().put(JSONObject().put("id",2).put("name","Борис"))))
        kotlin.concurrent.thread(isDaemon=true) { while(!server.isClosed)try { server.accept().use { socket ->
            val input=socket.getInputStream().bufferedReader();val line=input.readLine().orEmpty();var length=0
            var header=input.readLine();while(!header.isNullOrEmpty()){if(header.startsWith("Content-Length:",true))length=header.substringAfter(':').trim().toInt();header=input.readLine()}
            val chars=CharArray(length);var offset=0;while(offset<length){val n=input.read(chars,offset,length-offset);if(n<0)break;offset+=n}
            if(line.startsWith("POST")){val loaded=JSONObject(policy.get().toString());if(line.contains("/blocks/"))loaded.put("blocked",JSONArray()) else {val body=JSONObject(String(chars));loaded.put("allow_calls",body.getString("allow_calls")).put("relay_only",body.getBoolean("relay_only"))};policy.set(loaded)}
            val body=if(line.contains("/config"))"{\"relayConfigured\":true}" else policy.get().toString();val bytes=body.toByteArray()
            socket.getOutputStream().apply{write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
        } } catch(_:java.net.SocketException){} }
        val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        try {
            compose.runOnUiThread { activity.get().setContent { VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false) { NativeCallPrivacyScreen("test",NativeApi("http://127.0.0.1:${server.localPort}")){} } } }
            compose.waitUntil(10000){compose.onAllNodesWithText("Никто").fetchSemanticsNodes().isNotEmpty()}
            compose.onAllNodes(isSelectable())[2].performClick()
            compose.waitUntil(10000){policy.get().optString("allow_calls")=="nobody"}
            compose.waitForIdle();compose.onNode(isToggleable()).performClick()
            compose.waitUntil(10000){policy.get().optBoolean("relay_only")}
            compose.waitForIdle();compose.onNodeWithText("Борис — разблокировать").performScrollTo().performClick()
            compose.waitUntil(10000){policy.get().getJSONArray("blocked").length()==0}
            compose.onNodeWithText("Борис — разблокировать").assertDoesNotExist()
        } finally { compose.runOnUiThread { activity.pause().stop().destroy() };server.close() }
    }
}
