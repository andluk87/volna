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
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.platform.LocalDensity
import kotlin.math.roundToInt
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.border
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.webrtc.SurfaceViewRenderer

@Composable
fun NativeCallScreen(state: NativeCallState, token: String, standalone: Boolean = false, pip: Boolean = false, onMinimize: (() -> Unit)? = null) {
    val context = LocalContext.current
    val original = state.call ?: return
    val account = context.getSharedPreferences("volna-native", Context.MODE_PRIVATE).getLong("user_id", 0)
    val contactNames = rememberNativeContactNames(account)
    val call = original.copy(peer = original.peer?.let { it.copy(name = contactNames[it.id] ?: it.name) })
    val layout = remember(call.id) { NativeCallLayout.forCall(call.id) }
    SideEffect { if (call.video || state.remoteVideo || state.cameraEnabled || state.remoteSharing) layout.video = true }
    val videoMode = (layout.video || call.video || state.remoteVideo || state.cameraEnabled || state.remoteSharing) && call.status == "active"
    var routesOpen by remember { mutableStateOf(false) }
    var routes by remember { mutableStateOf(emptyList<NativeAudioRoute>()) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted -> if (granted[Manifest.permission.RECORD_AUDIO] == true && NativeCalls.state.value.call?.id == call.id) NativeCalls.accept(video = call.video && granted[Manifest.permission.CAMERA] == true) }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it && NativeCalls.state.value.call?.id == call.id) NativeCalls.previewCamera() }
    val bluetoothPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { routes = NativeCalls.routes(); routesOpen = true }
    val screenPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) result.data?.takeIf { NativeCalls.state.value.call?.id == call.id }?.let(NativeCalls::startScreenSharing)
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
    if (state.cameraPreview && !pip) {
        NativeCameraPreviewScreen(state, onScreen = { NativeCalls.cancelCameraPreview(); screenPermission.launch((context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent()) })
    } else if (pip) {
        NativeParticipantVideo(state, token, layout.localMain, Modifier.fillMaxSize(), overlay = false)
    } else {
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Ink, Panel, lerp(Panel, Accent, .12f))))) {
        if (videoMode) NativeParticipantVideo(state, token, layout.localMain, Modifier.fillMaxSize().clickable { layout.controls = !layout.controls }, overlay = false)
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
        if (!videoMode || layout.controls) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { minimize() }) { Icon(Icons.Outlined.CloseFullscreen, "Свернуть звонок", tint = TextMain) }
            Spacer(Modifier.weight(1f))
            if (state.connected) IconButton(onClick = {
                if (state.sharing) NativeCalls.stopScreenSharing()
                else screenPermission.launch((context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent())
            }, enabled = state.sharing || state.connected && state.screenReady) { Icon(if (state.sharing) Icons.Outlined.StopScreenShare else Icons.Outlined.ScreenShare, if (state.sharing) "Остановить показ экрана" else "Показать экран", tint = TextMain.copy(alpha = if (state.sharing || state.connected && state.screenReady) 1f else .5f)) }
        }
        if (videoMode) {
            NativeText("${call.peer?.name ?: "Видеозвонок"} · ${if (state.connected) callDuration(state.elapsed) else state.phase}", color = TextMain, fontSize = 13.sp)
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { layout.controls = !layout.controls }) {
                val density = LocalDensity.current
                val previewWidth = 110.dp.coerceAtMost(maxWidth)
                val previewHeight = 148.dp.coerceAtMost(maxHeight)
                val maxX = with(density) { (maxWidth - previewWidth).toPx().coerceAtLeast(0f) }
                val maxY = with(density) { (maxHeight - previewHeight).toPx().coerceAtLeast(0f) }
                val x = nativePreviewCoordinate((layout.position?.x ?: 1f) * maxX, maxX)
                val y = nativePreviewCoordinate((layout.position?.y ?: 0f) * maxY, maxY)
                NativeParticipantVideo(state, token, !layout.localMain, Modifier.offset { IntOffset(x.roundToInt(), y.roundToInt()) }.size(previewWidth, previewHeight).clip(RoundedCornerShape(14.dp)).border(1.dp, Accent.copy(alpha=.5f), RoundedCornerShape(14.dp)).clickable { layout.localMain = !layout.localMain }.pointerInput(maxX, maxY) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        val current = layout.position ?: Offset(1f, 0f)
                        layout.position = Offset(if (maxX > 0f) nativePreviewCoordinate(current.x * maxX + drag.x, maxX) / maxX else 0f, if (maxY > 0f) nativePreviewCoordinate(current.y * maxY + drag.y, maxY) / maxY else 0f)
                    }
                }, overlay = true)
            }
            if (state.cameraEnabled && layout.controls) TextButton(onClick = NativeCalls::switchCamera, modifier = Modifier.align(Alignment.End)) { Icon(Icons.Outlined.Cameraswitch, null); NativeText("Сменить камеру", fontSize = 12.sp) }
        } else {
            Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.Top, horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.weight(.25f))
                Box(Modifier.size(260.dp), contentAlignment = Alignment.Center) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column { repeat(3) { Icon(Icons.Outlined.Waves, null, tint = Accent.copy(alpha = .18f), modifier = Modifier.padding(8.dp).size(30.dp)) } }; Column { repeat(3) { Icon(Icons.Outlined.Waves, null, tint = Accent.copy(alpha = .18f), modifier = Modifier.padding(8.dp).size(30.dp)) } } }
                    Box(Modifier.size(214.dp).clip(CircleShape).background(Accent.copy(alpha = .10f)).border(7.dp, Accent.copy(alpha = .08f), CircleShape), contentAlignment = Alignment.Center) { Avatar(call.peer?.name ?: "В", call.peer?.id ?: 0, call.peer?.avatarUrl, token, size = 190.dp) }
                }
                NativeText(call.peer?.name ?: "Собеседник", color = TextMain, fontSize = 32.sp, fontWeight = FontWeight.Normal, modifier = Modifier.padding(top = 4.dp))
                NativeText(nativeCallStatus(state), color = TextMain.copy(alpha = .95f), fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp))
                if (state.sharing) NativeText("Ваш экран виден собеседнику", color = Accent, modifier = Modifier.padding(top = 12.dp))
                Spacer(Modifier.weight(1f))
            }
        }
        if (state.error.isNotBlank()) ErrorBanner(state.error)
        if (!videoMode || layout.controls || call.status == "ringing") {
        if (call.incoming && call.status == "ringing") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            CallControl(Icons.Outlined.Call, "Принять", Color(0xFF42CC41), enabled = !state.busy, size = 72.dp) {
                if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED && (!call.video || context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)) NativeCalls.accept(video = call.video)
                else micPermission.launch(if (call.video) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO))
            }
            CallControl(Icons.Outlined.CallEnd, "Отклонить", Color(0xFFF32638), size = 72.dp) { NativeCalls.end() }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallControl(Icons.Outlined.VolumeUp, "Динамик", Panel.copy(alpha = .85f)) {
                    if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
                    else { routes = NativeCalls.routes(); routesOpen = true }
                }
                CallControl(if (state.cameraEnabled) Icons.Outlined.VideocamOff else Icons.Outlined.Videocam, if (state.cameraEnabled) "Выкл. видео" else "Вкл. видео", if (state.cameraEnabled) Accent else Panel.copy(alpha = .85f), enabled = state.connected && state.screenReady) {
                    if (state.cameraEnabled) NativeCalls.setCamera(false)
                    else if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) NativeCalls.previewCamera()
                    else cameraPermission.launch(Manifest.permission.CAMERA)
                }
                CallControl(if (state.muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (state.muted) "Вкл. звук" else "Выкл. звук", if (state.muted) Accent else Panel.copy(alpha = .85f)) { NativeCalls.toggleMute() }
                CallControl(Icons.Outlined.CallEnd, "Завершить", Color(0xFFF32638)) { NativeCalls.end() }
            }

        }
        }
        if (state.sharing) NativeText("При блокировке Android может остановить показ экрана", color = TextMain.copy(alpha = .7f), fontSize = 10.sp)
        Spacer(Modifier.height(28.dp))
    }
    }
    }
    }
    if (standalone) content() else Dialog(onDismissRequest = { minimize() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) { NativeDialogSystemBars(); content() }
    if (routesOpen) AlertDialog(onDismissRequest = { routesOpen = false }, title = { NativeText("Аудиовыход") }, text = {
        Column { routes.forEach { route -> TextButton(onClick = { NativeCalls.selectRoute(route.id); routesOpen = false }) { NativeText(route.label) } }; if (routes.isEmpty()) NativeText("Аудиоустройства не найдены") }
    }, confirmButton = { TextButton(onClick = { routesOpen = false }) { NativeText("Закрыть") } })
}

@Composable
private fun CallControl(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, color: Color, enabled: Boolean = true, size: androidx.compose.ui.unit.Dp = 60.dp, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(onClick, enabled = enabled, modifier = Modifier.size(size).clip(CircleShape).background(if (enabled) color else Hover)) {
            Icon(icon, label, tint = nativeReadableText(listOf(if (enabled) color else Hover)).copy(alpha = if (enabled) 1f else .45f), modifier = Modifier.size(if (size > 60.dp) 34.dp else 28.dp))
        }
        NativeText(label, color = TextMain, fontSize = 11.sp, modifier = Modifier.padding(top = 7.dp))
    }
}

@Composable
private fun RemoteScreenVideo(modifier: Modifier, local: Boolean = false, overlay: Boolean = false) {
    val context = LocalContext.current
    val renderer = remember(overlay) {
        val surface = SurfaceViewRenderer(context)
        try { surface.init(NativeCalls.eglContext, null); surface.setEnableHardwareScaler(true); surface.setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL); surface.setMirror(local); surface.setZOrderMediaOverlay(overlay); surface }
        catch (_: RuntimeException) { runCatching { surface.release() }; null }
    }
    if (renderer == null) {
        Box(modifier, contentAlignment = Alignment.Center) { NativeText("Не удалось показать экран. Голосовой звонок продолжается.", color = Muted, fontSize = 12.sp) }
        return
    }
    SideEffect { renderer.setMirror(local && NativeCalls.state.value.cameraFront) }
    DisposableEffect(renderer, local) {
        runCatching { if (local) NativeCalls.attachLocalVideo(renderer) else NativeCalls.attachVideo(renderer) }
        onDispose { if (local) NativeCalls.detachLocalVideo(renderer) else NativeCalls.detachVideo(renderer) }
    }
    DisposableEffect(renderer) { onDispose { runCatching { renderer.release() } } }
    AndroidView(factory = { renderer }, modifier = modifier.clip(RoundedCornerShape(12.dp)))
}
private fun callDuration(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

internal fun nativePreviewCoordinate(value: Float, limit: Float) = value.coerceIn(0f, limit.coerceAtLeast(0f))

/** UI state belongs to the call, so hiding a screen never resets the layout. */
internal class NativeCallLayout {
    var localMain by mutableStateOf(false)
    var position by mutableStateOf<Offset?>(null)
    var controls by mutableStateOf(true)
    var video by mutableStateOf(false)
    companion object {
        private var id = ""
        private var layout = NativeCallLayout()
        var inPip by mutableStateOf(false)
        fun forCall(callId: String): NativeCallLayout { if (id != callId) { id = callId; layout = NativeCallLayout() }; return layout }
    }
}
@Composable
private fun NativeParticipantVideo(state: NativeCallState, token: String, local: Boolean, modifier: Modifier, overlay: Boolean) {
    if (if (local) state.cameraEnabled else state.remoteVideo || state.remoteSharing) RemoteScreenVideo(modifier, local, overlay)
    else Box(modifier.background(Panel), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (!local) Avatar(state.call?.peer?.name ?: "В", state.call?.peer?.id ?: 0, state.call?.peer?.avatarUrl, token, size = if (overlay) 48.dp else 120.dp)
            else Icon(Icons.Outlined.Person, null, tint = TextMain, modifier = Modifier.size(if (overlay) 48.dp else 120.dp))
            NativeText(if (local) "Вы · камера выключена" else "Камера выключена", color = TextMain, fontSize = if (overlay) 10.sp else 14.sp)
        }
    }
}

internal fun nativeCallStatus(state: NativeCallState): String = when {
    state.connected -> callDuration(state.elapsed)
    state.call?.status == "ringing" && state.call.incoming -> "Звонок Волна"
    state.call?.status == "ringing" -> "Ожидание…"
    state.phase.contains("Восстанов", ignoreCase = true) -> state.phase
    else -> "Соединение…"
}

@Composable
private fun NativeCameraPreviewScreen(state: NativeCallState, onScreen: () -> Unit) {
    BackHandler { NativeCalls.cancelCameraPreview() }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        RemoteScreenVideo(Modifier.fillMaxSize(), local = true)
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
            IconButton(onClick = NativeCalls::cancelCameraPreview) { Icon(Icons.Outlined.ArrowBack, "Назад", tint = TextMain) }
            Spacer(Modifier.weight(1f))
            Button(onClick = NativeCalls::publishCameraPreview, enabled = state.connected, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(9.dp), colors = ButtonDefaults.buttonColors(containerColor = Accent)) { NativeText("Включить трансляцию", color = nativeReadableText(listOf(Accent)), fontSize = 17.sp) }
            Row(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 28.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                TextButton(onClick = onScreen) { NativeText("Экран", color = TextMain, fontSize = 12.sp) }
                TextButton(onClick = { NativeCalls.previewCamera(true) }) { NativeText("Передняя камера", color = if (state.cameraFront) Color.White else Color.White.copy(alpha=.65f), fontSize = 12.sp) }
                TextButton(onClick = { NativeCalls.previewCamera(false) }) { NativeText("Задняя камера", color = if (!state.cameraFront) Color.White else Color.White.copy(alpha=.65f), fontSize = 12.sp) }
            }
        }
    }
}
