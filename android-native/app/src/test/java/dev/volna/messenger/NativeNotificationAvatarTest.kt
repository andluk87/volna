package dev.volna.messenger

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Icon
import coil.Coil
import coil.ImageLoader
import coil.decode.DataSource
import coil.intercept.Interceptor
import coil.request.SuccessResult
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeNotificationAvatarTest {
 private val context get()=RuntimeEnvironment.getApplication()
 private lateinit var previous: ImageLoader
 private lateinit var loader: ImageLoader
 private val requests=mutableListOf<coil.request.ImageRequest>()
 @Before fun start(){
  NativeCredentials.initialize(context)
  NativeNotificationAvatar.removeAccount(0)
  context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("test-avatar","Test",NotificationManager.IMPORTANCE_DEFAULT))
  previous=Coil.imageLoader(context)
  loader=ImageLoader.Builder(context).memoryCache(null).diskCache(null).components{add(Interceptor{chain->requests.add(chain.request);val photo=Bitmap.createBitmap(80,120,Bitmap.Config.ARGB_8888).apply{eraseColor(Color.BLUE)};SuccessResult(BitmapDrawable(context.resources,photo),chain.request,DataSource.MEMORY)})}.build()
  Coil.setImageLoader(loader)
 }
 @After fun close(){Coil.setImageLoader(previous);loader.shutdown()}
 private fun photo(color: Int)=NativeNotificationAvatar.circular(BitmapDrawable(context.resources,Bitmap.createBitmap(80,140,Bitmap.Config.ARGB_8888).apply{eraseColor(color)}))
 private fun pixel(icon:Icon):Int {val bitmap=(icon.loadDrawable(context) as BitmapDrawable).bitmap;return bitmap.getPixel(bitmap.width/2,bitmap.height/2)}
 private fun builder()=nativeNotificationBuilder(context,"test-avatar",includeArtwork=false).setContentTitle("Любимая").setContentText("Привет")
 private fun attach(builder:Notification.Builder,chat:Long,sender:Bitmap?=null,conversation:Bitmap?=null,group:Boolean=false,key:String="fixture"){
  NativeNotificationConversation.attach(context,builder,account=1,chat=chat,label=if(group)"Группа" else "Любимая",sender="Елена",body="Привет",time=1,launch=Intent(context,MainActivity::class.java),group=group,senderId=7,senderAvatar=sender,conversationAvatar=conversation,artworkKey=key)
 }
 @Test fun directNotificationCarriesTheActualAvatarInAllSystemUiSources(){
  val avatar=photo(Color.BLUE);val builder=builder();attach(builder,101,avatar,avatar)
  val notification=builder.build();assertEquals(Color.BLUE,pixel(notification.getLargeIcon()))
  val style=androidx.core.app.NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)!!
  assertEquals(Color.BLUE,pixel(style.messages.single().person!!.icon!!.toIcon(context)));assertEquals("volna-person-1-7",style.messages.single().person!!.key)
  val shortcut=context.getSystemService(ShortcutManager::class.java).dynamicShortcuts.first{it.id==nativeConversationId(1,101)}
  assertEquals(Color.BLUE,pixel(shortcut.javaClass.getMethod("getIcon").invoke(shortcut) as Icon));assertEquals(R.drawable.ic_volna_notification,notification.smallIcon.resId)
 }
 @Test fun groupConversationAndMessageSenderKeepDifferentAvatars(){
  val builder=builder();attach(builder,102,photo(Color.BLUE),photo(Color.RED),group=true)
  val notification=builder.build();assertEquals(Color.RED,pixel(notification.getLargeIcon()))
  val style=androidx.core.app.NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)!!;assertEquals(Color.BLUE,pixel(style.messages.single().person!!.icon!!.toIcon(context)));assertTrue(style.isGroupConversation)
 }
 @Test fun anExistingShortcutIsUpdatedWhenThePhotoChangesWithoutRenamingTheChat(){
  val first=builder();attach(first,103,photo(Color.BLUE),photo(Color.BLUE),key="blue")
  val second=builder();attach(second,103,photo(Color.GREEN),photo(Color.GREEN),key="green")
  val shortcut=context.getSystemService(ShortcutManager::class.java).dynamicShortcuts.first{it.id==nativeConversationId(1,103)};assertEquals(Color.GREEN,pixel(shortcut.javaClass.getMethod("getIcon").invoke(shortcut) as Icon))
 }
 @Test fun missingPhotoUsesCircularInitialsInsteadOfTheApplicationLogo(){
  val builder=builder();attach(builder,104)
  val icon=builder.build().getLargeIcon();assertNotNull(icon)
  val bitmap=(icon.loadDrawable(context) as BitmapDrawable).bitmap;assertEquals(0,Color.alpha(bitmap.getPixel(0,0)));assertNotEquals(0,Color.alpha(bitmap.getPixel(bitmap.width/8,bitmap.height/2)))
 }
 @Test fun avatarIsCroppedToACircleWithoutBakingInAnApplicationBadge(){
  val avatar=photo(Color.BLUE);assertEquals(192,avatar.width);assertEquals(192,avatar.height);assertEquals(Color.BLUE,avatar.getPixel(96,96));assertEquals(0,Color.alpha(avatar.getPixel(191,191)))
 }
 @Test fun protectedAvatarRequestsUseAuthenticationButExternalImagesDoNot()=runBlocking{
  val avatar=NativeNotificationAvatar.load(context,"notification-test-token","/api/files/"+"a".repeat(48));assertNotNull(avatar);assertEquals("Bearer notification-test-token",requests.last().headers["Authorization"])
  NativeNotificationAvatar.load(context,"notification-test-token","https://other.invalid/photo.png");assertNull(requests.last().headers["Authorization"])
 }
 @Test @Config(sdk=[27]) fun legacyAndroidStillReceivesALargeAvatar(){val avatar=photo(Color.BLUE);val builder=builder();attach(builder,105,avatar,avatar);assertEquals(Color.BLUE,pixel(builder.build().getLargeIcon()))}
 @Test fun portraitsAreReusedForOneAccountAndClearedOnLogout()=runBlocking{
  val url="/api/files/"+"b".repeat(48)
  NativeNotificationAvatar.load(context,"account-one",url);assertEquals(1,requests.size)
  NativeNotificationAvatar.load(context,"account-one",url);assertEquals(1,requests.size)
  NativeNotificationAvatar.load(context,"account-two",url);assertEquals(2,requests.size)
  NativeNotificationAvatar.removeAccount(0)
  NativeNotificationAvatar.load(context,"account-one",url);assertEquals(3,requests.size)
 }

}
