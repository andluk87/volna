package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.test.core.app.ApplicationProvider
import com.airbnb.lottie.LottieDrawable
import com.airbnb.lottie.LottieCompositionFactory
import java.util.zip.GZIPInputStream
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeAnimatedEmojiTest {
    @Test fun everyBundledAnimationParsesNatively() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val rows = JSONObject(context.assets.open("animated-emoji/manifest.json").bufferedReader().use { it.readText() }).getJSONObject("entries")
        assertTrue(rows.length() >= 580)
        val failures = mutableListOf<String>()
        rows.keys().forEach { emoji ->
            val file = rows.getJSONObject(emoji).getString("file")
            val result = GZIPInputStream(context.assets.open("animated-emoji/$file")).use { LottieCompositionFactory.fromJsonInputStreamSync(it, null) }
            val composition = result.value
            if (composition == null) { failures.add("$emoji ($file): ${result.exception?.stackTraceToString()}"); return@forEach }
            assertEquals(512, composition!!.bounds.width())
            assertTrue(composition.duration > 0)
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
        assertEquals(NativeAnimatedEmojiCatalog.file(context,"❤"), NativeAnimatedEmojiCatalog.file(context,"❤️"))
        assertNull(NativeAnimatedEmojiCatalog.file(context,"Привет 😁"))
    }
    @Test fun sampleAnimationsDrawVisiblePixels() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val examples = listOf("😀", "😁", "😇", "🤔", "💯", "❤️", "🥉")
        val sheet = Bitmap.createBitmap(128 * examples.size, 128, Bitmap.Config.ARGB_8888)
        val target = Canvas(sheet)
        examples.forEachIndexed { index, emoji ->
            val composition = NativeAnimatedEmojiCatalog.load(context, NativeAnimatedEmojiCatalog.file(context,emoji)!!)!!
            val bitmap = Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888)
            val drawable = LottieDrawable(); drawable.enableMergePathsForKitKatAndAbove(true)
            drawable.setComposition(composition); drawable.setBounds(0,0,128,128); drawable.progress = .5f
            drawable.draw(Canvas(bitmap))
            val pixels = IntArray(128*128); bitmap.getPixels(pixels,0,128,0,0,128,128)
            assertTrue("Empty animation $emoji", pixels.count { (it ushr 24) > 0 } > 100)
            if (emoji == "❤️") assertTrue("Heart must contain red artwork, not the mislabeled skull", pixels.count { val r = it shr 16 and 255; val g = it shr 8 and 255; val b = it and 255; (it ushr 24) > 0 && r > 120 && r > g * 1.5 && r > b * 1.5 } > 100)
            target.drawBitmap(bitmap,(index*128).toFloat(),0f,null); bitmap.recycle()
        }
        val file = File("build/reports/animated-emoji/native-samples.png"); file.parentFile?.mkdirs()
        file.outputStream().use { sheet.compress(Bitmap.CompressFormat.PNG,100,it) }; sheet.recycle()
    }
}
