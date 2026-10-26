package dev.volna.messenger
import android.app.Application
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
@Config(sdk = [35], qualifiers = "w400dp-h850dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativePhotoViewerUiTest {
 @get:Rule val compose = createEmptyComposeRule()
 private lateinit var activity: ActivityController<ComponentActivity>
 private val actions = mutableListOf<Pair<Long,String>>()
 private val photos = (0..2).map { index -> VolnaMessage(20L+index,1,"Автор","","2026-10-15T12:30:00Z",false,"photo-$index.png",attachmentId=('e'+index).toString().repeat(48),attachmentMime="image/png",chatId=1) }
 @Before fun start() {
  activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
  photos.forEach { photo -> val f=File(activity.get().cacheDir,"attachments/${photo.attachmentId}/${photo.attachmentName}");f.parentFile!!.mkdirs();val image=Bitmap.createBitmap(100,100,Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.WHITE) };f.outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) };image.recycle() }
  compose.runOnUiThread { activity.get().setContent { VolnaTheme(NativeAppearance(theme="dark")) { NativePhotoViewer(photos.first(),photos,"test",NativeApi("http://127.0.0.1:1"),{}, { true },{ m,a -> actions.add(m.id to a) },{}) } } }
  compose.waitForIdle()
 }
 @After fun close() { compose.runOnUiThread { activity.pause().stop().destroy() } }
 @Test fun navigationAndReplyUseCurrentlyDisplayedPhoto() {
  compose.onNodeWithText("Далее →").performClick();compose.onNodeWithText("Фото 2 / 3").assertIsDisplayed()
  compose.onNodeWithText("Меню ⋮").performClick();compose.onNodeWithText("Ответить").performClick()
  compose.runOnIdle { assertEquals(listOf(21L to "reply"),actions) }
 }
 @Test fun deleteRequiresConfirmationAndUsesCurrentPhoto() {
  compose.onNodeWithText("Далее →").performClick();compose.onNodeWithText("Меню ⋮").performClick();compose.onNodeWithText("Удалить").performClick()
  compose.onNodeWithText("Удалить фото?").assertIsDisplayed();compose.runOnIdle { assertTrue(actions.isEmpty()) }
  compose.onNodeWithText("Удалить",useUnmergedTree=true).performClick();compose.runOnIdle { assertEquals(listOf(21L to "delete"),actions) }
 }
}
