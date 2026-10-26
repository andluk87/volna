package dev.volna.messenger

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.unit.*
import coil.Coil
import coil.ImageLoader
import coil.decode.DataSource
import coil.intercept.Interceptor
import coil.request.ImageResult
import coil.request.SuccessResult
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.concurrent.ConcurrentHashMap

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w400dp-h850dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeMediaAlbumUiTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var activity: ActivityController<ComponentActivity>
    private lateinit var previous: ImageLoader
    private lateinit var loader: ImageLoader
    private val loaded = ConcurrentHashMap.newKeySet<String>()
    private val opened = mutableListOf<Long>()
    private val photos = (0..3).map { index -> VolnaMessage(10L + index, 1, "Иван", "", "2026-10-15T12:30:00Z", false, "Фото ${index + 1}",
        attachmentId = ('a' + index).toString().repeat(48), attachmentMime = "image/jpeg", albumId = "album") }

    @Before fun start() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        val context = activity.get()
        previous = Coil.imageLoader(context)
        loader = ImageLoader.Builder(context).memoryCache(null).diskCache(null).components {
            add(object : Interceptor {
                override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                    val path = chain.request.data.toString()
                    if (!path.contains("/api/files/")) return chain.proceed(chain.request)
                    val index = photos.indexOfFirst { path.endsWith(it.attachmentId!!) }.coerceAtLeast(0)
                    val bitmap = Bitmap.createBitmap(500, 350, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(listOf(0xFFB6DCC8, 0xFFAACCEA, 0xFFE9BDA8, 0xFFD0B9EA)[index].toInt())
                    val paint = Paint().apply { color = android.graphics.Color.WHITE; textSize = 100f; textAlign = Paint.Align.CENTER }
                    canvas.drawText("${index + 1}", 250f, 210f, paint)
                    loaded.add(path)
                    return SuccessResult(BitmapDrawable(context.resources, bitmap), chain.request, DataSource.MEMORY)
                }
            })
        }.build()
        Coil.setImageLoader(loader)
    }
    @After fun close() { compose.runOnUiThread { activity.pause().stop().destroy() }; Coil.setImageLoader(previous); loader.shutdown() }
    private fun content(messages: List<VolnaMessage> = photos, dark: Boolean = true, own: Boolean = true, timeOnTap: Boolean = false) {
        compose.runOnUiThread { activity.get().setContent {
            val context = LocalContext.current
            val voice = remember { NativeVoicePlayback(context) {} }
            NativeEmojiProvider { VolnaTheme(NativeAppearance(theme = if (dark) "dark" else "light", timeOnTap = timeOnTap)) {
                Box(Modifier.width(360.dp).background(Ink).padding(vertical = 8.dp)) {
                    MessageBubble(messages.first(), messages, own, true, false, false, false, false,
                        {}, {}, {}, {}, { _, _, _ -> }, {}, voice, "", { opened.add(it.id) }, false, false, 1,
                        false, false, {}, {}, {}, false, {}, true)
                }
            } }
        } }
        compose.waitForIdle()
        compose.waitUntil(5000) { loaded.size >= messages.size }
        compose.waitForIdle()
    }
    private fun screenshot(name: String) { compose.runOnUiThread {
        val view = activity.get().window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        val file = File("build/reports/media-album/$name.png").apply { parentFile!!.mkdirs() }
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    } }
    @Test fun fourPhotosUseHeroAndThreeThumbnailsWithOneOverlaidStamp() {
        content()
        val hero = compose.onNodeWithTag("album-item-10", true).getUnclippedBoundsInRoot()
        val thumbs = (11L..13L).map { compose.onNodeWithTag("album-item-$it", true).getUnclippedBoundsInRoot() }
        assertTrue(hero.width > thumbs.first().width * 2.8f)
        assertTrue(thumbs.all { it.top > hero.bottom })
        assertTrue(thumbs.map { it.top }.distinct().size == 1)
        val media = compose.onNodeWithTag("message-media-10", true).getUnclippedBoundsInRoot()
        val stamp = compose.onNodeWithTag("media-stamp-10", true).getUnclippedBoundsInRoot()
        val bubble = compose.onNodeWithTag("message-bubble-10", true).getUnclippedBoundsInRoot()
        assertTrue(stamp.bottom < media.bottom && stamp.right < media.right && stamp.top > thumbs.first().top)
        assertEquals(media.bottom.value, bubble.bottom.value, 1f)
        compose.onAllNodesWithContentDescription("Доставлено").assertCountEquals(1)
        screenshot("four-photos-dark")
    }
    @Test fun photoGapsShowTheChatBackgroundEvenWithCaptions() {
        content(photos.mapIndexed { index, m -> if (index == 0) m.copy(text = "Подпись") else m })
        val a = compose.onNodeWithTag("album-item-11", true).getUnclippedBoundsInRoot()
        val b = compose.onNodeWithTag("album-item-12", true).getUnclippedBoundsInRoot()
        compose.runOnUiThread {
            val view = activity.get().findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0)
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val gap = bitmap.getPixel(((a.right.value+b.left.value)/2).toInt(), ((a.top.value+a.bottom.value)/2).toInt())
            assertEquals(bitmap.getPixel(0, 2), gap)
            bitmap.recycle()
        }
    }
    @Test fun singlePhotoHasTimeInsideImageWithoutASeparateFooter() {
        content(listOf(photos.first()))
        val media = compose.onNodeWithTag("message-media-10", true).getUnclippedBoundsInRoot()
        val stamp = compose.onNodeWithTag("media-stamp-10", true).getUnclippedBoundsInRoot()
        val bubble = compose.onNodeWithTag("message-bubble-10", true).getUnclippedBoundsInRoot()
        assertTrue(stamp.bottom < media.bottom)
        assertEquals(media.bottom.value, bubble.bottom.value, 1f)
        screenshot("single-photo")
    }
    @Test fun captionsStayBelowMediaAndUseOneCommonTimestamp() {
        content(photos.mapIndexed { index, message -> if (index == 0) message.copy(text = "Подпись к альбому") else message })
        compose.onNodeWithText("Подпись к альбому").assertIsDisplayed()
        compose.onNodeWithTag("media-stamp-10", true).assertDoesNotExist()
        compose.onAllNodesWithContentDescription("Доставлено").assertCountEquals(1)
        val media = compose.onNodeWithTag("message-media-10", true).getUnclippedBoundsInRoot()
        val tick = compose.onNodeWithContentDescription("Доставлено", useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertTrue(tick.top >= media.bottom)
        screenshot("with-caption")
    }
    @Test fun everyCellOpensItsOwnPhotoAndLongPressKeepsItsTarget() {
        content()
        for (id in 10L..13L) compose.onNodeWithTag("album-item-$id").performClick()
        compose.runOnIdle { assertEquals(listOf(10L, 11L, 12L, 13L), opened) }
        compose.onNodeWithTag("album-item-12").performTouchInput { longClick() }
        compose.onNodeWithText("Открыть или сохранить").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(12L, opened.last()) }
    }
    @Test fun incomingLightAlbumKeepsTimeReadableOnTheImage() {
        content(dark = false, own = false)
        compose.onNodeWithTag("media-stamp-10", true).assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Доставлено").assertCountEquals(0)
        screenshot("four-photos-light")
    }
    @Test fun timeOnTapCanBeRevealedWithoutOpeningThePhoto() {
        content(own = false, timeOnTap = true)
        compose.onNodeWithTag("media-stamp-10", true).assertDoesNotExist()
        compose.onNodeWithContentDescription("Показать время сообщения").performClick()
        compose.onNodeWithTag("media-stamp-10", true).assertIsDisplayed()
        compose.runOnIdle { assertTrue(opened.isEmpty()) }
    }
}
