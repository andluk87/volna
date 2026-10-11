package dev.volna.messenger

import android.app.Notification
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

internal object CallAlerts {
    fun settings(context: Context, intent: Intent) { runCatching { context.startActivity(intent) }.onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) } } }
    fun fullScreenAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    fun show(context: Context, call: VolnaCall) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(NativeCalls.CALL_CHANNEL, "Входящие звонки", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null); enableVibration(false); lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        val open = IncomingCallActivity.pending(context, call.id)
        val answer = IncomingCallActivity.pending(context, call.id, answer = true)
        val decline = PendingIntent.getBroadcast(context, NativeCalls.CALL_NOTIFICATION,
            Intent(context, CallActionReceiver::class.java).setAction(CallService.ACTION_END).putExtra("call_id", call.id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, NativeCalls.CALL_CHANNEL)
            .setSmallIcon(R.drawable.ic_volna).setContentTitle(call.peer?.name ?: "Волна")
            .setContentText("Входящий звонок").setCategory(Notification.CATEGORY_CALL)
            .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(true).setOnlyAlertOnce(true)
        if (fullScreenAllowed(context)) notification.setFullScreenIntent(open, true)
        if (Build.VERSION.SDK_INT >= 31) notification.setStyle(Notification.CallStyle.forIncomingCall(
            Person.Builder().setName(call.peer?.name ?: "Собеседник").setImportant(true).build(), decline, answer))
        else notification.addAction(Notification.Action.Builder(null, "Отклонить", decline).build())
            .addAction(Notification.Action.Builder(null, "Ответить", answer).build())
        manager.notify(NativeCalls.CALL_NOTIFICATION, notification.build())
    }
}

@Composable
internal fun CallAlertsSettings(automatic: Boolean = false) {
    val context = LocalContext.current
    var revision by remember { mutableStateOf(0) }
    val lifecycle = (context as? ComponentActivity)?.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) revision++ }
        lifecycle?.addObserver(observer)
        onDispose { lifecycle?.removeObserver(observer) }
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    val ready = remember(revision) { CallAlerts.fullScreenAllowed(context) && manager.areNotificationsEnabled() &&
        (manager.getNotificationChannel(MessagingService.CHANNEL_ID)?.importance ?: NotificationManager.IMPORTANCE_HIGH) >= NotificationManager.IMPORTANCE_HIGH &&
        (manager.getNotificationChannel(NativeCalls.CALL_CHANNEL)?.importance ?: NotificationManager.IMPORTANCE_HIGH) >= NotificationManager.IMPORTANCE_HIGH }
    var open by remember { mutableStateOf(false) }
    var prompted by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { revision++ }
    LaunchedEffect(revision, automatic) {
        if (automatic && !ready && !prompted) {
            prompted = true
            open = true
        }
    }
    if (!ready && !automatic) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        TextButton(onClick = { open = true }) { NativeText("Включить экран входящего звонка", fontSize = 12.sp) }
    }
    LaunchedEffect(ready) { if (ready) open = false }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { NativeText("Уведомления и звонки") }, text = {
        Column {
            NativeText("Разрешите уведомления и полноэкранный показ: при входящем звонке телефон включит экран с кнопками ответа. Переписка остаётся за блокировкой.")
            if (Build.VERSION.SDK_INT >= 34) TextButton(onClick = {
                CallAlerts.settings(context, Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
            }) { NativeText(if (CallAlerts.fullScreenAllowed(context)) "Полноэкранный показ разрешён" else "Разрешить полноэкранный показ") }
            TextButton(onClick = {
                if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && (!context.getSharedPreferences("volna-notification-setup", Context.MODE_PRIVATE).getBoolean("requested", false) || (context as? ComponentActivity)?.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) == true)) {
                    context.getSharedPreferences("volna-notification-setup", Context.MODE_PRIVATE).edit().putBoolean("requested", true).apply()
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    CallAlerts.settings(context, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                }
            }) { NativeText("Включить уведомления") }
            if ((manager.getNotificationChannel(MessagingService.CHANNEL_ID)?.importance ?: NotificationManager.IMPORTANCE_HIGH) < NotificationManager.IMPORTANCE_HIGH) TextButton(onClick = {
                CallAlerts.settings(context, Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, MessagingService.CHANNEL_ID))
            }) { NativeText("Включить всплывающие сообщения") }
            if ((manager.getNotificationChannel(NativeCalls.CALL_CHANNEL)?.importance ?: NotificationManager.IMPORTANCE_HIGH) < NotificationManager.IMPORTANCE_HIGH) TextButton(onClick = {
                CallAlerts.settings(context, Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, NativeCalls.CALL_CHANNEL))
            }) { NativeText("Включить всплывающие звонки") }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { NativeText("Готово") } })
}
