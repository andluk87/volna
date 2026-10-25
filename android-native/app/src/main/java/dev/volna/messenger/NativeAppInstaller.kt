package dev.volna.messenger

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageInstaller
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

internal suspend fun installVolnaApk(context:Context,file:File,allowSilent:Boolean=false)=withContext(Dispatchers.IO){
 val archive=context.packageManager.getPackageArchiveInfo(file.absolutePath,0)?:error("APK недоступен")
 require((if(Build.VERSION.SDK_INT>=28)archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong())>BuildConfig.VERSION_CODE){"APK не содержит более новой версии VLN"}
 require(archive.packageName==context.packageName){"Обновление предназначено для другого приложения"}
 val installer=context.packageManager.packageInstaller
 val params=PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply{
  setAppPackageName(context.packageName)
  if(Build.VERSION.SDK_INT>=31)setRequireUserAction(if(allowSilent)PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED else PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
  if(Build.VERSION.SDK_INT>=34)setPermissionState(Manifest.permission.USE_FULL_SCREEN_INTENT,if(CallAlerts.fullScreenAllowed(context))PackageInstaller.SessionParams.PERMISSION_STATE_GRANTED else PackageInstaller.SessionParams.PERMISSION_STATE_DENIED)
 }
 val id=installer.createSession(params)
 try{installer.openSession(id).use{session->
  file.inputStream().use{input->session.openWrite("volna.apk",0,file.length()).use{output->input.copyTo(output);session.fsync(output)}}
  if(allowSilent){
   val unused=!context.getSystemService(android.os.PowerManager::class.java).isInteractive||context.getSystemService(KeyguardManager::class.java).isKeyguardLocked
   require(context.getSharedPreferences("volna-update-install",0).getLong("requested",0)==0L&&context.getSharedPreferences("volna-native",0).getBoolean("updates_install_idle",false)&&unused&&NativeCalls.state.value.call==null&&!NativeCalls.state.value.busy&&NativeBackgroundCalls.calls.value.isEmpty()&&!NativeIdleUpdater.transferBusy){"Автоустановка отложена: устройство снова используется"}
  }
  context.getSharedPreferences("volna-update-install",0).edit().putLong("requested",System.currentTimeMillis()).putInt("before",BuildConfig.VERSION_CODE).putBoolean("silent",allowSilent).commit()
  val intent=Intent(context,VolnaInstallResultActivity::class.java).setAction("dev.volna.messenger.INSTALL_RESULT").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  val flags=PendingIntent.FLAG_UPDATE_CURRENT or if(Build.VERSION.SDK_INT>=31)PendingIntent.FLAG_MUTABLE else 0
  val options=if(Build.VERSION.SDK_INT>=35)ActivityOptions.makeBasic().apply{setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)}.toBundle() else null
  NativeCredentials.refreshGate.install { session.commit(PendingIntent.getActivity(context,id,intent,flags,options).intentSender) }
 }}catch(problem:Exception){installer.abandonSession(id);context.getSharedPreferences("volna-update-install",0).edit().clear().apply();throw problem}
}
internal fun nativeUpdateRelaunch(before:Int,current:Int,requested:Long,now:Long)=before>0&&current>before&&requested>0&&now>=requested&&now-requested<30*60*1000
class VolnaUpdateReceiver:BroadcastReceiver(){
 override fun onReceive(context:Context,intent:Intent){
  val prefs=context.getSharedPreferences("volna-update-install",0)
  if(intent.action=="dev.volna.messenger.INSTALL_RESULT"){
   val status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)
   if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){
    val confirm=if(Build.VERSION.SDK_INT>=33)intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
    if(prefs.getBoolean("silent",false)){NativeCredentials.refreshGate.resume();prefs.edit().putString("error","Android требует подтверждения. Откройте VLN и нажмите «Обновить сейчас».").apply();notify(context,"Обновление скачано. Подтвердите установку в VLN") }else if(confirm==null)NativeCredentials.refreshGate.resume() else confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).let{runCatching{context.startActivity(it)}.onFailure{NativeCredentials.refreshGate.resume()}};return
   }
   NativeCredentials.refreshGate.resume()
   if(status!=PackageInstaller.STATUS_SUCCESS){val text=if(status==PackageInstaller.STATUS_FAILURE_ABORTED)"Установка отменена. Обновление остаётся скачанным." else "Android не установил обновление. Откройте VLN и повторите.";prefs.edit().clear().putString("error",text).apply();notify(context,text);return}
  }else if(intent.action!=Intent.ACTION_MY_PACKAGE_REPLACED)return
  // Package replacement kills the old process. Restore delivery even when Android
  // refuses a background Activity launch, or the update came from another installer.
  if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED ||
      intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE) == PackageInstaller.STATUS_SUCCESS) {
   runCatching { MessagingService.restore(context) }
  }
  val legacy=intent.action==Intent.ACTION_MY_PACKAGE_REPLACED&&File(context.filesDir,"updates/volna-${BuildConfig.VERSION_CODE}.apk").isFile&&prefs.getInt("handled_version",0)!=BuildConfig.VERSION_CODE
  if(!legacy&&!nativeUpdateRelaunch(prefs.getInt("before",0),BuildConfig.VERSION_CODE,prefs.getLong("requested",0),System.currentTimeMillis()))return
  prefs.edit().clear().putInt("handled_version",BuildConfig.VERSION_CODE).commit()
  val launch=Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("after_update",true)
  runCatching{context.startActivity(launch)}
  notify(context,"Обновление установлено. Открыть VLN")
 }
 private fun notify(context:Context,text:String){
  val manager=context.getSystemService(NotificationManager::class.java)
  if(!manager.areNotificationsEnabled())return
  manager.createNotificationChannel(NotificationChannel("volna_updates","Обновления",NotificationManager.IMPORTANCE_LOW))
  val open=PendingIntent.getActivity(context,11090,Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  runCatching{manager.notify(11090,nativeNotificationBuilder(context,"volna_updates").setContentTitle("VLN").setContentText(text).setContentIntent(open).setAutoCancel(true).build())}
 }
}

/** An explicit installer callback activity can return to Main while the install UI is visible. */
class VolnaInstallResultActivity:Activity(){
 override fun onCreate(state:android.os.Bundle?){
  super.onCreate(state)
  val status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)
  VolnaUpdateReceiver().onReceive(this,intent)
  if(status==PackageInstaller.STATUS_SUCCESS)startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
  finish()
 }
}
