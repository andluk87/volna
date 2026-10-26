package dev.volna.messenger

import android.widget.VideoView
import android.widget.MediaController
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import kotlinx.coroutines.*
import java.io.File
import kotlin.math.abs

internal fun nativePanLimit(viewWidth: Float, viewHeight: Float, ratio: Float, zoom: Float): Offset {
    val width = minOf(viewWidth,viewHeight*ratio); val height = width/ratio
    return Offset(maxOf(0f,(width*zoom-viewWidth)/2),maxOf(0f,(height*zoom-viewHeight)/2))
}
@Composable
internal fun NativeMediaFrame(title: String, panels: Boolean, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest=onDismiss, properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        NativeDialogSystemBars(Color.Black)
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),color=Color.Black) {
            Column(Modifier.fillMaxSize()) {
                // Keep layout stable when hiding controls so the image does not jump.
                Row(Modifier.fillMaxWidth().height(56.dp).graphicsLayer { alpha=if(panels)1f else 0f },verticalAlignment=Alignment.CenterVertically) {
                    TextButton(enabled=panels,onClick=onDismiss) { Text("Назад",color=Color.White) }
                    Text(title,color=Color.White,modifier=Modifier.weight(1f),maxLines=1)
                }
                content()
            }
        }
    }
}
@Composable
internal fun NativeMediaSurface(message: VolnaMessage, file: File?, token: String, onStep: (Int)->Unit, onDismiss: ()->Unit, onToggle: ()->Unit, onError: (String)->Unit, modifier: Modifier = Modifier) {
    val context=LocalContext.current
    var zoom by remember(message.id) { mutableStateOf(1f) }; var pan by remember(message.id) { mutableStateOf(Offset.Zero) }; var drag by remember(message.id) { mutableStateOf(Offset.Zero) }; var ratio by remember(message.id) { mutableStateOf(1f) }
    var player by remember(message.id) { mutableStateOf<VideoView?>(null) }
    val video=message.attachmentMime?.startsWith("video/")==true
    val step by rememberUpdatedState(onStep);val close by rememberUpdatedState(onDismiss);val toggle by rememberUpdatedState(onToggle)
    val lifecycle=LocalLifecycleOwner.current
    DisposableEffect(message.id,lifecycle) {val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_PAUSE)player?.pause()};lifecycle.lifecycle.addObserver(observer);onDispose {lifecycle.lifecycle.removeObserver(observer);player?.stopPlayback()}}

    Box(modifier.background(Color.Black).clipToBounds().semantics {stateDescription="Масштаб ${(zoom*100).toInt()}%";if(!video)customActions=listOf(CustomAccessibilityAction("Увеличить"){zoom=(zoom+.5f).coerceAtMost(4f);true},CustomAccessibilityAction("Сбросить масштаб"){zoom=1f;pan=Offset.Zero;true})}.pointerInput(message.id,video) {
        if(!video) coroutineScope {
            var lastTap=0L;var tapJob: Job?=null
            awaitEachGesture {
                val down=awaitFirstDown(requireUnconsumed=false);val start=down.position;var moved=false;var pinch=false;var end=start
                do {
                    val event=awaitPointerEvent();val count=event.changes.count { it.pressed }
                    if(count>=2) {
                        pinch=true;moved=true;zoom=(zoom*event.calculateZoom()).coerceIn(1f,4f)
                        val limit=nativePanLimit(size.width.toFloat(),size.height.toFloat(),ratio,zoom)
                        val next=pan+event.calculatePan();pan=Offset(next.x.coerceIn(-limit.x,limit.x),next.y.coerceIn(-limit.y,limit.y));drag=Offset.Zero
                    } else if(!pinch) {
                        end=event.changes.first().position;val delta=end-start
                        if(delta.getDistance()>viewConfiguration.touchSlop)moved=true
                        if(zoom>1f) {val limit=nativePanLimit(size.width.toFloat(),size.height.toFloat(),ratio,zoom);val next=pan+event.calculatePan();pan=Offset(next.x.coerceIn(-limit.x,limit.x),next.y.coerceIn(-limit.y,limit.y))}
                        else drag=if(abs(delta.x)>abs(delta.y))Offset(delta.x,0f) else Offset(0f,maxOf(0f,delta.y))
                    }
                    if(moved)event.changes.forEach { it.consume() }
                } while(event.changes.any { it.pressed })
                val delta=end-start
                if(!pinch&&zoom==1f) { if(abs(delta.x)>size.width*.22f&&abs(delta.x)>abs(delta.y)*1.2f)step(if(delta.x<0)1 else -1) else if(delta.y>size.height*.15f&&delta.y>abs(delta.x)*1.2f)close() }
                if(!moved&&!pinch) {val now=System.currentTimeMillis();if(now-lastTap<300){tapJob?.cancel();zoom=if(zoom==1f)2f else 1f;pan=Offset.Zero;lastTap=0}else{lastTap=now;tapJob=launch{delay(300);toggle()}}}
                drag=Offset.Zero
            }
        } else {
            // The player's controls keep taps; horizontal drags navigate the same media sequence.
            detectHorizontalDragGestures(onDragStart={drag=Offset.Zero},onHorizontalDrag={change,amount->change.consume();drag+=Offset(amount,0f)},onDragEnd={if(abs(drag.x)>size.width*.22f)step(if(drag.x<0)1 else -1);drag=Offset.Zero})
        }
    },contentAlignment=Alignment.Center) {
        val transform=Modifier.fillMaxSize().graphicsLayer {scaleX=zoom;scaleY=zoom;translationX=pan.x+drag.x;translationY=pan.y+drag.y}
        if(video&&file!=null) AndroidView(factory={ VideoView(it).apply {player=this;setAudioFocusRequest(android.media.AudioManager.AUDIOFOCUS_NONE);setMediaController(MediaController(it));setVideoURI(FileProvider.getUriForFile(context,"${context.packageName}.fileprovider",file));setOnPreparedListener { p -> if(NativeCalls.state.value.call!=null)p.setVolume(0f,0f) };setOnErrorListener { _,_,_->onError("Формат видео не поддерживается. Сохраните файл для открытия в другом приложении.");true } } },modifier=transform)
        else if(!video) AsyncImage(model=file?:imageRequest(context,"/api/files/${message.attachmentId}?message_id=${message.id}",token),contentDescription=message.attachmentName,contentScale=ContentScale.Fit,modifier=transform,onSuccess={ratio=it.result.drawable.intrinsicWidth.toFloat().coerceAtLeast(1f)/it.result.drawable.intrinsicHeight.coerceAtLeast(1)})
        if(file==null) CircularProgressIndicator(Modifier.size(28.dp))
    }
}
