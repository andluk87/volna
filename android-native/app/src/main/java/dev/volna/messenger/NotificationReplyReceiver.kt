package dev.volna.messenger

import android.app.Notification
import android.app.NotificationManager
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.UUID
import kotlin.concurrent.thread

/** Direct reply works without selecting this account or opening the phone UI. */
class NotificationReplyReceiver:BroadcastReceiver(){
 override fun onReceive(context:Context,intent:Intent){
  if(intent.action!="dev.volna.messenger.REPLY"||intent.data?.host!="reply")return
  val parts=intent.data?.pathSegments.orEmpty()
  if(parts.size!=3)return
  val ids=parts.map{it.toLongOrNull()?:return}
  if(ids.any{it<=0})return
  val text=RemoteInput.getResultsFromIntent(intent)?.getCharSequence("volna_reply")?.toString()?.trim()?.takeIf{it.isNotEmpty()&&it.length<=4096}?:return
  val (account,chat,message)=ids
  val pending=goAsync()
  thread(name="volna-watch-reply",isDaemon=true){
   val manager=context.getSystemService(NotificationManager::class.java)
   val tag="volna-account-$account"
   val notificationId=(message xor (message ushr 32)).toInt() and 0x1fffffff
   try{
    val token=NativeCredentials.access(account)
    require(token.isNotBlank()){"Войдите в аккаунт на телефоне"}
    val clientId=nativeNotificationReplyId(account,chat,message,text)
    NativeApi(BuildConfig.API_BASE_URL,8).send(token,chat,text,replyTo=message,clientId=clientId)
    manager.cancel(tag,notificationId)
   }catch(_:Exception){
    runCatching{manager.activeNotifications.firstOrNull{it.tag==tag&&it.id==notificationId}?.let{
     manager.notify(tag,notificationId,Notification.Builder.recoverBuilder(context,it.notification).setContentText("Ответ не отправлен. Повторите ответ или откройте VLN.").setOnlyAlertOnce(true).build())
    }}
   }finally{pending.finish()}
  }
 }
}

internal fun nativeNotificationReplyId(account:Long,chat:Long,message:Long,text:String)=UUID.nameUUIDFromBytes("watch:$account:$chat:$message:$text".toByteArray()).toString().replace("-","")
