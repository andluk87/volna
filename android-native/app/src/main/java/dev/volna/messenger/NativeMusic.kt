package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal fun nativeIsMusic(message: VolnaMessage) = !message.deleted && message.attachmentMime?.startsWith("audio/")==true && !message.attachmentName.orEmpty().startsWith("Голосовое-")
internal fun nativeMusicNext(ids: List<Long>, current: Long, direction: Int, shuffle: Boolean, wrap: Boolean): Long? {
    val index=ids.indexOf(current);if(index<0||ids.isEmpty())return null
    if(shuffle&&direction>0&&ids.size>1)return ids.filter{it!=current}.random()
    val next=index+direction
    return if(next in ids.indices)ids[next] else if(wrap)ids[(next%ids.size+ids.size)%ids.size] else null
}
@Composable
internal fun NativeMusicBar(playback: NativeVoicePlayback) {
    val message=playback.currentMessage?:return
    var options by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxWidth().background(Panel)) {
        Row(Modifier.fillMaxWidth().height(40.dp).padding(horizontal=4.dp),verticalAlignment=Alignment.CenterVertically) {
            IconButton(onClick={playback.nextMusic(-1)},modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.SkipPrevious,"Предыдущий трек",tint=Accent,modifier=Modifier.size(20.dp))}
            IconButton(onClick=playback::toggleCurrent,modifier=Modifier.size(32.dp)){if(playback.loading)CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)else Icon(if(playback.playing)Icons.Outlined.Pause else Icons.Outlined.PlayArrow,if(playback.playing)"Приостановить музыку" else "Продолжить музыку",tint=Accent,modifier=Modifier.size(20.dp))}
            IconButton(onClick={playback.nextMusic()},modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.SkipNext,"Следующий трек",tint=Accent,modifier=Modifier.size(20.dp))}
            NativeText(message.attachmentName.orEmpty().substringBeforeLast('.'),Modifier.weight(1f).padding(horizontal=5.dp),color=TextMain,fontSize=12.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            NativeText("%02d:%02d".format(playback.positionMs/60000,playback.positionMs/1000%60),color=Muted,fontSize=11.sp)
            Box {IconButton(onClick={options=true},modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.Tune,"Настройки музыки",tint=Accent,modifier=Modifier.size(19.dp))}
                DropdownMenu(expanded=options,onDismissRequest={options=false}) {
                    Column(Modifier.width(230.dp).padding(12.dp)){
                        NativeText("Громкость музыки",color=TextMain,fontSize=13.sp);Slider(value=playback.volume,onValueChange=playback::changeVolume)
                        TextButton(onClick=playback::toggleShuffle){NativeText(if(playback.shuffle)"Перемешивание: включено" else "Перемешать треки",color=Accent)}
                        TextButton(onClick=playback::changeRepeat){NativeText(when(playback.repeatMode){"all"->"Повтор очереди";"one"->"Повтор одного трека";else->"Без повтора"},color=Accent)}
                        TextButton(onClick=playback::changeSpeed){NativeText("Скорость: ${playback.musicSpeed}×",color=Accent)}
                        TextButton(onClick={options=false}){NativeText("Готово",color=Accent)}
                    }
                }
            }
            IconButton(onClick={playback.stop()},modifier=Modifier.size(32.dp)){Icon(Icons.Outlined.Close,"Закрыть музыкальный плеер",tint=Muted,modifier=Modifier.size(18.dp))}
        }
        val fraction=if(playback.durationMs>0)(playback.positionMs.toFloat()/playback.durationMs).coerceIn(0f,1f) else 0f
        val trackColor=Muted.copy(alpha=.28f);val progressColor=Accent
        Canvas(Modifier.fillMaxWidth().height(14.dp).semantics{contentDescription="Перемотка музыки";progressBarRangeInfo=ProgressBarRangeInfo(fraction,0f..1f);if(playback.durationMs>0)setProgress{playback.seekCurrent(it);true} else disabled()}.pointerInput(playback.durationMs){detectTapGestures{if(playback.durationMs>0)playback.seekCurrent(it.x/size.width.coerceAtLeast(1))}}.pointerInput(playback.durationMs){detectDragGestures{change,_->if(playback.durationMs>0){change.consume();playback.seekCurrent(change.position.x/size.width.coerceAtLeast(1))}}}){val y=size.height/2;drawLine(trackColor,Offset(0f,y),Offset(size.width,y),2.dp.toPx());drawLine(progressColor,Offset(0f,y),Offset(size.width*fraction,y),2.dp.toPx())}
    }
}

@Composable
internal fun NativeMusicMessage(message: VolnaMessage, playback: NativeVoicePlayback, onPlay: ()->Unit) {
    val selected=playback.messageId==message.id
    Row(Modifier.fillMaxWidth().heightIn(min=52.dp),verticalAlignment=Alignment.CenterVertically){
        IconButton(onClick=onPlay,modifier=Modifier.size(44.dp).background(Accent,androidx.compose.foundation.shape.CircleShape)){if(selected&&playback.loading)CircularProgressIndicator(Modifier.size(20.dp),color=androidx.compose.ui.graphics.Color.White,strokeWidth=2.dp)else Icon(if(selected&&playback.playing)Icons.Outlined.Pause else Icons.Outlined.PlayArrow,if(selected&&playback.playing)"Приостановить музыку" else "Воспроизвести музыку",tint=androidx.compose.ui.graphics.Color.White)}
        Column(Modifier.weight(1f).padding(start=10.dp)){NativeText(message.attachmentName.orEmpty().substringBeforeLast('.'),color=TextMain,fontSize=14.sp,maxLines=2,overflow=TextOverflow.Ellipsis);NativeText(if(selected&&playback.durationMs>0)"%02d:%02d / %02d:%02d".format(playback.positionMs/60000,playback.positionMs/1000%60,playback.durationMs/60000,playback.durationMs/1000%60)else "Музыкальный файл",color=Accent,fontSize=12.sp)}
    }
}
