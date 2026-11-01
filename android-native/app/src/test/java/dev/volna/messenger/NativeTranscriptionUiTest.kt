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
 @Test fun transcriptIsRequestedAfreshAndClearedOnCollapse(){
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible();val playback=NativeVoicePlayback(activity.get()){}
  var calls=0;var consumed=0
  var message by mutableStateOf(VolnaMessage(1,1,"Имя","","2026-10-30T00:00:00Z",false,"Голосовое-1.m4a",attachmentId="a".repeat(48),attachmentMime="audio/mp4",attachmentSize=6*1024*1024))
  try{compose.runOnUiThread{activity.get().setContent{VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false){NativeVoiceMessage(message,"test",playback,{},false,{calls++;message=message.copy(transcript="Текст $calls")},onTranscriptConsumed={consumed++;message=message.copy(transcript=null)})}}}
   compose.onNodeWithContentDescription("Расшифровать голосовое").performClick();compose.onNodeWithText("Текст 1").assertIsDisplayed();assertEquals(1,calls)
   compose.runOnIdle{assertNull(message.transcript);assertTrue(consumed>0)}
   compose.onNodeWithContentDescription("Расшифровать голосовое").performClick();compose.onNodeWithText("Текст 1").assertDoesNotExist()
   compose.onNodeWithContentDescription("Расшифровать голосовое").performClick();compose.onNodeWithText("Текст 2").assertIsDisplayed();assertEquals(2,calls)
  }finally{playback.close();compose.runOnUiThread{activity.pause().stop().destroy()}}
 }
}
