package dev.volna.messenger

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.webrtc.SurfaceViewRenderer

@Composable
fun NativeCallScreen(state: NativeCallState, token: String, standalone: Boolean = false, onMinimize: (() -> Unit)? = null) {
    val context = LocalContext.current
    val call = state.call ?: return
    var routesOpen by remember { mutableStateOf(false) }
    var routes by remember { mutableStateOf(emptyList<NativeAudioRoute>()) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) NativeCalls.accept() }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) NativeCalls.setCamera(true) }
    val bluetoothPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { routes = NativeCalls.routes(); routesOpen = true }
    val screenPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) result.data?.let(NativeCalls::startScreenSharing)
    }
    val minimize = { if (onMinimize != null) onMinimize() else NativeCalls.minimize(true) }
    BackHandler(enabled = !state.minimized || standalone) { minimize() }
    if (state.minimized && !standalone) {
        Row(Modifier.fillMaxWidth().background(Outgoing).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).clickable { NativeCalls.minimize(false) }) {
                NativeText(call.peer?.name ?: "Волна", fontWeight = FontWeight.SemiBold, color = TextMain, fontSize = 13.sp)
                NativeText(if (state.connected) callDuration(state.elapsed) + if (state.sharing) " · Показ экрана" else " · Разговор" else state.phase, color = Muted, fontSize = 11.sp)
            }
            IconButton(onClick = NativeCalls::toggleMute) { Icon(if (state.muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, "Микрофон", tint = Accent) }
            IconButton(onClick = { NativeCalls.end() }) { Icon(Icons.Outlined.CallEnd, "Завершить звонок", tint = Color(0xFFE7767F)) }
        }
        return
    }
    val content: @Composable () -> Unit = {
    Column(Modifier.fillMaxSize().background(Ink).windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            NativeText(if (call.incoming && call.status == "ringing") if (call.video) "Входящий видеозвонок" else "Входящий звонок" else if (call.video || state.cameraEnabled || state.remoteVideo) "Видеозвонок" else "Аудиозвонок", color = Muted, modifier = Modifier.weight(1f))
            TextButton(onClick = { minimize() }) { Icon(Icons.Outlined.ExpandMore, null); NativeText("Свернуть") }
        }
        if (state.remoteSharing || state.remoteVideo || state.cameraEnabled) {
            NativeText(if (state.remoteSharing) "Собеседник показывает экран" else call.peer?.name ?: "Видеозвонок", color = Accent, fontSize = 12.sp)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (state.remoteSharing || state.remoteVideo) RemoteScreenVideo(Modifier.fillMaxSize())
                else NativeText(state.phase, Modifier.align(Alignment.Center), color = Muted)
                if (state.cameraEnabled) RemoteScreenVideo(Modifier.align(Alignment.BottomEnd).size(width = 110.dp, height = 148.dp), local = true)
            }
            if (state.cameraEnabled) TextButton(onClick = NativeCalls::switchCamera, modifier = Modifier.align(Alignment.End)) { Icon(Icons.Outlined.Cameraswitch, null); NativeText("Сменить камеру", fontSize = 12.sp) }
        } else {
            Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(call.peer?.name ?: "В", call.peer?.id ?: 0, call.peer?.avatarUrl, token)
                NativeText(call.peer?.name ?: "Собеседник", fontSize = 26.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 20.dp))
                NativeText(state.phase, color = Muted, modifier = Modifier.padding(top = 8.dp))
                if (state.connected) NativeText(callDuration(state.elapsed), color = Accent, fontSize = 22.sp, modifier = Modifier.padding(top = 12.dp))
                if (state.sharing) NativeText("Ваш экран виден собеседнику", color = Accent, modifier = Modifier.padding(top = 12.dp))
                if (!state.relay) NativeText("TURN не настроен: связь через разные сети может быть недоступна", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 14.dp))
            }
        }
        if (state.error.isNotBlank()) ErrorBanner(state.error)
        if (call.incoming && call.status == "ringing") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            CallControl(Icons.Outlined.CallEnd, "Отклонить", Color(0xFFE26771)) { NativeCalls.end() }
            CallControl(Icons.Outlined.Call, "Ответить", Color(0xFF54BC91), enabled = !state.busy) {
                if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) NativeCalls.accept()
                else micPermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallControl(if (state.muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (state.muted) "Включить" else "Микрофон", if (state.muted) Accent else Hover) { NativeCalls.toggleMute() }
                CallControl(if (state.cameraEnabled) Icons.Outlined.VideocamOff else Icons.Outlined.Videocam, "Камера", if (state.cameraEnabled) Accent else Hover, enabled = state.connected && state.screenReady) {
                    if (state.cameraEnabled) NativeCalls.setCamera(false)
                    else if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) NativeCalls.setCamera(true)
                    else cameraPermission.launch(Manifest.permission.CAMERA)
                }
                CallControl(if (state.sharing) Icons.Outlined.StopScreenShare else Icons.Outlined.ScreenShare, if (state.sharing) "Стоп экран" else "Экран", if (state.sharing) Accent else Hover, enabled = state.sharing || state.connected && state.screenReady) {
                    if (state.sharing) NativeCalls.stopScreenSharing()
                    else screenPermission.launch((context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent())
                }
                CallControl(Icons.Outlined.CallEnd, "Завершить", Color(0xFFE26771)) { NativeCalls.end() }
            }
            TextButton(modifier = Modifier.align(Alignment.CenterHorizontally), onClick = {
                if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
                else { routes = NativeCalls.routes(); routesOpen = true }
            }) { Icon(Icons.Outlined.VolumeUp, null); NativeText("  ${state.route}") }
        }
        NativeText(if (state.sharing) "При блокировке Android может остановить показ экрана. Голосовой звонок продолжится." else "Звонок остаётся активным при сворачивании и выключении экрана", color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
    }
    }
    if (standalone) content() else Dialog(onDismissRequest = { minimize() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) { NativeDialogSystemBars(); content() }
    if (routesOpen) AlertDialog(onDismissRequest = { routesOpen = false }, title = { NativeText("Аудиовыход") }, text = {
        Column { routes.forEach { route -> TextButton(onClick = { NativeCalls.selectRoute(route.id); routesOpen = false }) { NativeText(route.label) } }; if (routes.isEmpty()) NativeText("Аудиоустройства не найдены") }
    }, confirmButton = { TextButton(onClick = { routesOpen = false }) { NativeText("Закрыть") } })
}

@Composable
private fun CallControl(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, color: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(onClick, enabled = enabled, modifier = Modifier.size(60.dp).clip(CircleShape).background(if (enabled) color else Input)) {
            Icon(icon, label, tint = if (enabled) TextMain else Muted)
        }
        NativeText(label, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 7.dp))
    }
}

@Composable
private fun RemoteScreenVideo(modifier: Modifier, local: Boolean = false) {
    val context = LocalContext.current
    val renderer = remember {
        val surface = SurfaceViewRenderer(context)
        try { surface.init(NativeCalls.eglContext, null); surface.setEnableHardwareScaler(true); surface.setMirror(local); surface.setZOrderMediaOverlay(local); surface }
        catch (_: RuntimeException) { runCatching { surface.release() }; null }
    }
    if (renderer == null) {
        Box(modifier, contentAlignment = Alignment.Center) { NativeText("Не удалось показать экран. Голосовой звонок продолжается.", color = Muted, fontSize = 12.sp) }
        return
    }
    DisposableEffect(renderer) {
        runCatching { if (local) NativeCalls.attachLocalVideo(renderer) else NativeCalls.attachVideo(renderer) }
        onDispose { if (local) NativeCalls.detachLocalVideo(renderer) else NativeCalls.detachVideo(renderer); runCatching { renderer.release() } }
    }
    AndroidView(factory = { renderer }, modifier = modifier.clip(RoundedCornerShape(12.dp)))
}
private fun callDuration(seconds: Int) = "%d:%02d".format(seconds / 60, seconds % 60)
