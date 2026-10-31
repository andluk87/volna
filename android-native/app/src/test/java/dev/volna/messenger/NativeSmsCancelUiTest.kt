package dev.volna.messenger

import android.app.Application
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeSmsCancelUiTest {
 @get:Rule val compose=createEmptyComposeRule()
 private class Monitor:NativeSmsMonitor {
  override val appHash=""
  var stops=0
  override suspend fun start(retriever:Boolean,onMessage:(String)->Unit,onConsent:(Intent)->Unit,onTimeout:()->Unit)=false
  override fun stop(){stops++}
 }
 private class Repo(val waiting:Boolean):NativeAuthRepository {
  override suspend fun config()=JSONObject()
  override suspend fun start(phone:String,request:String,hash:String):JSONObject {if(waiting)awaitCancellation();throw NativeApiException(503,"Не удалось отправить SMS","SMS_UNAVAILABLE")}
  override suspend fun resend(id:String,request:String)=start("","","")
  override suspend fun status(id:String)=JSONObject()
  override suspend fun cancel(id:String){}
  override suspend fun verify(id:String,code:String):VolnaSession=error("unexpected verify")
 }
 @Test fun canReturnToExistingAccountAfterSmsProviderError(){checkCancel(false)}
 @Test fun canCancelWithoutWaitingForTheSmsRequestToFinish(){checkCancel(true)}
 @Test fun appInviteIsResolvableAndShowsAConfirmationBeforeJoining(){
  val context=RuntimeEnvironment.getApplication();val code="a".repeat(48)
  val matches=context.packageManager.queryIntentActivities(Intent(Intent.ACTION_VIEW,android.net.Uri.parse("volna://invite/$code")).addCategory(Intent.CATEGORY_BROWSABLE),0)
  assertTrue(matches.any { it.activityInfo.name.endsWith("MainActivity") })
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible();var joined=0
  try {
   compose.runOnUiThread { activity.get().setContent { VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false) {
    CommunityEntryDialog("join:$code","fixture",NativeApi("https://example.invalid"),{}) { joined++ }
   } } }
   compose.onNodeWithText("Войти по приглашению").assertIsDisplayed()
   compose.onNodeWithText(code).assertIsDisplayed()
   compose.onNodeWithText("Войти").assertIsDisplayed()
   assertEquals(0,joined)
  } finally { compose.runOnUiThread { activity.pause().stop().destroy() } }
 }
 @Test fun invitationInMessageUsesExplicitApplicationIntentWithoutBrowser(){
  val url=BuildConfig.API_BASE_URL+"/app?invite="+"a".repeat(48)
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
  try {
   compose.runOnUiThread { activity.get().setContent { VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false) {
    NativeLinkedText("[Вступить]($url)")
   } } }
   compose.onNodeWithText("Вступить").performTouchInput { click(center) }
   compose.runOnIdle {
    val intent=org.robolectric.Shadows.shadowOf(activity.get()).nextStartedActivity
    assertNotNull(intent)
    assertEquals(MainActivity::class.java.name,intent.component?.className)
    assertEquals(url,intent.dataString)
   }
  } finally { compose.runOnUiThread { activity.pause().stop().destroy() } }
 }
 private fun checkCancel(waiting:Boolean){
  val context=RuntimeEnvironment.getApplication();val monitor=Monitor();var returned=0;var stored=0
  val model=NativeSmsAuthViewModel(context,null,SavedStateHandle(),Repo(waiting),monitor,{android.os.SystemClock.elapsedRealtime()},{stored++})
  val activity=Robolectric.buildActivity(ComponentActivity::class.java).setup().visible()
  try{
   compose.runOnUiThread {
    activity.get().setContent {
     VolnaTheme(NativeAppearance(theme="dark"),updateSystemBars=false) {
      NativeSmsLogin(NativeApi("https://example.invalid"),null,false,"",{},onCancel={returned++},modelOverride=model) { error("unexpected session") }
     }
    }
   }
   compose.onNodeWithText(context.getString(R.string.sms_auth_phone_number)).performTextInput("9001234567")
   compose.runOnIdle { assertEquals("9001234567",model.state.value.phone) }
   compose.onNodeWithText(context.getString(R.string.sms_auth_continue)).performScrollTo().performClick()
   compose.waitUntil(10000){if(waiting)model.state.value.busy else model.state.value.error.isNotBlank()}
   compose.onNodeWithText("Вернуться в аккаунт").performScrollTo().performClick()
   compose.runOnIdle {assertEquals(1,returned);assertFalse(model.state.value.busy);assertEquals(NativeAuthPhase.PHONE_INPUT,model.state.value.phase);assertEquals(0,stored);assertTrue(monitor.stops>0)}
  }finally{compose.runOnUiThread {activity.pause().stop().destroy();model.viewModelScope.cancel()}}
 }
}
