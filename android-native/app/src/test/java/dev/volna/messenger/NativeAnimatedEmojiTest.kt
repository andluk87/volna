package dev.volna.messenger

import android.app.Application
import com.airbnb.lottie.LottieCompositionFactory
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.zip.GZIPInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeAnimatedEmojiTest {
    @Test fun packagedIndexAndEveryOriginalTgsAreAvailableOffline() {
        val context = RuntimeEnvironment.getApplication()
        val index = JSONObject(context.assets.open("animated-emoji/index.json").bufferedReader().use { it.readText() })
        assertEquals(580, index.length())
        val files = context.assets.list("animated-emoji")!!.filter { it.endsWith(".tgs") }
        assertEquals(599, files.size)
        for (file in files) {
            val data = JSONObject(GZIPInputStream(context.assets.open("animated-emoji/$file")).bufferedReader().use { it.readText() })
            assertEquals(file, 60, data.getInt("fr"))
            assertTrue(file, data.getDouble("op") > data.getDouble("ip"))
        }
        assertEquals(NativeAnimatedEmojiAssets.file(context, "❤"), NativeAnimatedEmojiAssets.file(context, "❤️"))
        assertNull(NativeAnimatedEmojiAssets.file(context, "Текст 😁"))
    }
    @Test fun nativeLottieRendererParsesRepresentativeSmileysHeartsAndZwjSequences() {
        val context = RuntimeEnvironment.getApplication()
        for (emoji in listOf("😁", "❤️", "🥳", "🤔", "🔥", "👩‍💻")) {
            val file = NativeAnimatedEmojiAssets.file(context, emoji) ?: continue
            val result = GZIPInputStream(context.assets.open("animated-emoji/$file")).use { LottieCompositionFactory.fromJsonInputStreamSync(it, "test:$file") }
            assertNotNull("$emoji: ${result.exception}", result.value)
            assertEquals(60f, result.value!!.frameRate, 0.001f)
            assertTrue(result.value!!.duration > 0)
        }
    }
}
