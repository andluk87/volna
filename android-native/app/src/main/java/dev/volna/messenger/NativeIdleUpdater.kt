package dev.volna.messenger

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import android.os.SystemClock
import java.io.File
import kotlinx.coroutines.*

/** Shares the messaging service lifetime; no background activity is needed to request a self-update. */
internal object NativeIdleUpdater {
 val downloadLock=Any()
 @Volatile var transferBusy=false
 private var job:Job?=null
 fun start(context:Context){
  if(job?.isActive==true)return
  val app=context.applicationContext
  job=CoroutineScope(SupervisorJob()+Dispatchers.IO).launch {
   val prefs=app.getSharedPreferences("volna-native",0)
   val installPrefs=app.getSharedPreferences("volna-update-install",0)
   val api=NativeApi(BuildConfig.API_BASE_URL)
   var idleSince=0L;var nextCheck=0L;var release:VolnaUpdate?=null;var attempted=0L
   while(isActive){
    try {
     val now=SystemClock.elapsedRealtime()
     val unused=!app.getSystemService(PowerManager::class.java).isInteractive||app.getSystemService(KeyguardManager::class.java).isKeyguardLocked
     if(!unused)idleSince=0L else if(idleSince==0L)idleSince=now
     val enabled=prefs.getBoolean("updates_install_idle",false)
     if(!enabled)attempted=0L
     if(enabled&&now>=nextCheck){nextCheck=now+15*60*1000;release=api.checkUpdate(BuildConfig.VOLNA_VERSION_CODE);release?.let{api.downloadUpdate(it,File(app.filesDir,"updates/volna-${it.versionCode}.apk"))}}
     val candidate=release
     if(candidate!=null&&candidate.versionCode!=attempted&&nativeIdleUpdateAllowed(enabled,unused,if(idleSince>0)now-idleSince else 0,NativeCalls.state.value.call!=null||NativeCalls.state.value.busy||NativeBackgroundCalls.calls.value.isNotEmpty(),transferBusy)&&app.packageManager.canRequestPackageInstalls()&&installPrefs.getLong("requested",0)==0L){
      installVolnaApk(app,File(app.filesDir,"updates/volna-${candidate.versionCode}.apk"),allowSilent=true)
      attempted=candidate.versionCode
     }
    }catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){/* Retry network failures on the next scheduled check; manual updates remain available. */}
    delay(30_000)
   }
  }
 }
 fun stop(){job?.cancel();job=null}
}
internal fun nativeIdleUpdateAllowed(enabled:Boolean,unused:Boolean,idleMillis:Long,inCall:Boolean,transferring:Boolean)=enabled&&unused&&idleMillis>=600_000&&!inCall&&!transferring
