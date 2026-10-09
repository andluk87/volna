package dev.volna.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Keeps the WebView's call process alive and refreshes the call lease while Android sleeps. */
public class CallKeepAliveService extends Service {
 public static final String ACTION_START="dev.volna.messenger.CALL_START";
 private static final String ACTION_STOP="dev.volna.messenger.CALL_STOP";
 private static final String CHANNEL="active_call";
 private static final int NOTIFICATION_ID=9142;
 private PowerManager.WakeLock wakeLock;
 private ScheduledExecutorService heartbeat;
 private volatile String api="",token="",device="";

 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent==null||ACTION_STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
  if(!ACTION_START.equals(intent.getAction()))return START_NOT_STICKY;
  api=intent.getStringExtra("api");token=intent.getStringExtra("token");device=intent.getStringExtra("device");
  String peer=intent.getStringExtra("peer");if(peer==null||peer.trim().isEmpty())peer="Volna";
  try{
   createChannel();
   Intent launch=getPackageManager().getLaunchIntentForPackage(getPackageName());
   PendingIntent content=launch==null?null:PendingIntent.getActivity(this,0,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
   Notification notification=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(getApplicationInfo().icon)
    .setContentTitle("Звонок в Volna").setContentText("Разговор с "+peer+" продолжается")
    .setCategory(NotificationCompat.CATEGORY_CALL).setOngoing(true).setOnlyAlertOnce(true)
    .setContentIntent(content).build();
   if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
   else startForeground(NOTIFICATION_ID,notification);
   acquireCpu();startHeartbeat();
  }catch(Exception error){stopSelf();}
  return START_NOT_STICKY;
 }
 private void createChannel(){if(Build.VERSION.SDK_INT>=26){NotificationManager nm=(NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);if(nm.getNotificationChannel(CHANNEL)==null)nm.createNotificationChannel(new NotificationChannel(CHANNEL,"Активный звонок",NotificationManager.IMPORTANCE_LOW));}}
 private void acquireCpu(){PowerManager pm=(PowerManager)getSystemService(Context.POWER_SERVICE);wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Volna:ActiveCall");wakeLock.setReferenceCounted(false);wakeLock.acquire(4L*60L*60L*1000L);}
 private synchronized void startHeartbeat(){if(heartbeat!=null){heartbeat.shutdownNow();}heartbeat=Executors.newSingleThreadScheduledExecutor();heartbeat.scheduleWithFixedDelay(this::touchCall,0,20,TimeUnit.SECONDS);}
 private void touchCall(){HttpURLConnection connection=null;try{
  if(api==null||!api.startsWith("https://")||token==null||device==null)return;
  String url=api+"/api/calls/current?device="+URLEncoder.encode(device,StandardCharsets.UTF_8.name());
  connection=(HttpURLConnection)new URL(url).openConnection();connection.setRequestMethod("GET");connection.setConnectTimeout(8000);connection.setReadTimeout(8000);connection.setRequestProperty("Authorization","Bearer "+token);
  int status=connection.getResponseCode();if(status==200){java.io.InputStream in=connection.getInputStream();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[512];int count;while((count=in.read(buffer))!=-1&&out.size()<2048)out.write(buffer,0,count);in.close();String value=new String(out.toByteArray(),StandardCharsets.UTF_8).trim();if("null".equals(value))stopSelf();}
 }catch(Exception ignored){}finally{if(connection!=null)connection.disconnect();}}
 @Override public void onDestroy(){if(heartbeat!=null)heartbeat.shutdownNow();if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();stopForeground(true);super.onDestroy();}
 @Override public IBinder onBind(Intent intent){return null;}
}
