package dev.volna.messenger

import android.app.Application
import android.net.Uri
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
@Config(sdk=[35],application=Application::class,qualifiers="w393dp-h850dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeUploadUiTest {
    @get:Rule val compose=createEmptyComposeRule()
    @Test fun realProgressCancelRetryAndCommitHaveDistinctActions(){
        val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
        val batch=NativeAttachmentBatch(1,listOf(NativeSelectedAttachment(Uri.EMPTY,"Volna-Android.apk","application/vnd.android.package-archive",size=16*1048576)),"",null,{})
        var progress by mutableStateOf(NativeUploadProgress(sent=4*1048576,total=16*1048576))
        var error by mutableStateOf("");var cancelled=0;var retries=0
        try {
            compose.runOnUiThread {activity.get().setContent {VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false){NativeUploadCards(batch,progress,error,true,{cancelled++},{retries++})}}}
            compose.onNodeWithText("4.0 МБ / 16.0 МБ").assertIsDisplayed()
            compose.runOnUiThread { val view=activity.get().window.decorView;val image=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888);view.draw(android.graphics.Canvas(image));val file=java.io.File("/repo/work/upload-reference/android-progress.png");file.parentFile?.mkdirs();file.outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)} }
            compose.onNodeWithContentDescription("Отменить загрузку").performClick();assertEquals(1,cancelled)
            compose.runOnIdle {error="Нет сети"}
            compose.onNodeWithContentDescription("Повторить отправку").performClick();assertEquals(1,retries)
            compose.runOnIdle {error="";progress=progress.copy(committing=true)}
            compose.onNodeWithText("Отправляем…").assertIsDisplayed();compose.onNodeWithContentDescription("Отменить загрузку").assertDoesNotExist()
            compose.runOnIdle {error="Ответ сервера потерян"}
            compose.onNodeWithContentDescription("Повторить отправку").assertIsDisplayed()
        }finally{compose.runOnUiThread{activity.pause().stop().destroy()}}
    }
}
