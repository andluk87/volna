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
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource
import java.io.File
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class,qualifiers="w412dp-h915dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeMusicUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 @Test fun barControlsQueueAndCloseWithoutNetwork(){
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible();val errors=mutableListOf<String>();val playback=NativeVoicePlayback(activity.get()){errors.add(it)}
  val token="music-test";val hash=java.security.MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).take(12).joinToString(""){"%02x".format(it.toInt() and 255)}
  val songs=listOf("First Song.mp3","Second Song.mp3").mapIndexed{index,name->val id=(index+1).toString().repeat(48);val file=File(activity.get().cacheDir,"voices/$hash/$id");file.parentFile?.mkdirs();file.writeBytes(ByteArray(100));ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(file.absolutePath),ShadowMediaPlayer.MediaInfo(180000,0));VolnaMessage(index+1L,1,"Имя","","",false,name,id,"audio/mpeg",attachmentSize=100)}
  songs.forEach{message->val cached=kotlinx.coroutines.runBlocking{NativeVoiceRepository.load(activity.get(),token,message,waveform=false)};assertTrue(cached.file.isFile);ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(cached.file.absolutePath),ShadowMediaPlayer.MediaInfo(180000,0))}
  try{compose.runOnUiThread{activity.get().setContent{VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false){NativeMusicBar(playback)}};playback.setMusicQueue(token,songs);playback.toggle(token,songs[0])}
   compose.waitUntil(10000){org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();assertTrue(errors.toString(),errors.isEmpty());playback.durationMs==180000};compose.onNodeWithText("First Song").assertIsDisplayed()
   compose.onNodeWithContentDescription("Следующий трек").performClick();compose.waitUntil(10000){org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();playback.messageId==2L&&!playback.loading};compose.onNodeWithText("Second Song").assertIsDisplayed()
   compose.onNodeWithContentDescription("Перемотка музыки").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.SetProgress){it(.5f)};assertEquals(90000,playback.positionMs)
   compose.onNodeWithContentDescription("Настройки музыки").performClick();compose.onNodeWithText("Перемешать треки").performClick();assertTrue(playback.shuffle);compose.onNodeWithText("Без повтора").performClick();assertEquals("all",playback.repeatMode)
   if(compose.onAllNodesWithText("Готово").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithText("Готово").performScrollTo().performClick();
   compose.runOnUiThread{val view=activity.get().window.decorView;val bitmap=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888);view.draw(android.graphics.Canvas(bitmap));val file=File("/repo/work/music91/android-bar.png");file.parentFile?.mkdirs();file.outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}};compose.onNodeWithContentDescription("Закрыть музыкальный плеер").performClick();assertEquals(0L,playback.messageId);assertFalse(playback.isMusic);assertTrue(errors.toString(),errors.isEmpty())
  }finally{playback.close();compose.runOnUiThread{activity.pause().stop().destroy()}}
 }
}
