package dev.volna.messenger
import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeTranscriptionUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 @Test fun cachedTranscriptCanBeReplacedWithoutInvokingTheCachedAction(){
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible();val playback=NativeVoicePlayback(activity.get()){}
  var forced=0;var cached=0;var busy by mutableStateOf(false)
  val message=VolnaMessage(1,1,"Имя","","2026-10-30T00:00:00Z",false,"Голосовое-1.m4a",attachmentId="a".repeat(48),attachmentMime="audio/mp4",attachmentSize=6*1024*1024,transcript="Ранее распознанный текст")
  try{compose.runOnUiThread{activity.get().setContent{VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false){NativeVoiceMessage(message,"test",playback,{},busy,{cached++},onRetranscribe={forced++})}}}
   compose.onNodeWithContentDescription("Расшифровать голосовое").performClick();compose.onNodeWithText("Ранее распознанный текст").assertIsDisplayed();assertEquals(0,cached)
   compose.onNodeWithText("Распознать заново").performClick();assertEquals(1,forced)
   compose.runOnIdle{busy=true};compose.onNodeWithText("Распознаём…").assertIsNotEnabled()
  }finally{playback.close();compose.runOnUiThread{activity.pause().stop().destroy()}}
 }
}
