package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink

internal data class NativeUploadProgress(val index: Int = 0, val sent: Long = 0, val total: Long = 0, val committing: Boolean = false)
internal fun uploadBytesLabel(bytes: Long): String = if(bytes >= 1024*1024)String.format(java.util.Locale.US,"%.1f МБ",bytes/1048576.0) else if(bytes >= 1024)String.format(java.util.Locale.US,"%.1f КБ",bytes/1024.0) else "${bytes.coerceAtLeast(0)} Б"
internal class NativeUploadBody(private val bytes: ByteArray, private val mime: MediaType?, private val progress: (Long,Long)->Unit): RequestBody() {
    override fun contentType() = mime
    override fun contentLength() = bytes.size.toLong()
    override fun writeTo(sink: BufferedSink) {
        var offset=0;var last=0L
        progress(0,contentLength())
        while(offset<bytes.size){val size=minOf(64*1024,bytes.size-offset);sink.write(bytes,offset,size);offset+=size;val now=System.nanoTime();if(now-last>=100_000_000||offset==bytes.size){progress(offset.toLong(),contentLength());last=now}}
    }
}

@Composable
internal fun NativeUploadCards(batch: NativeAttachmentBatch, progress: NativeUploadProgress, error: String, busy: Boolean, onCancel: ()->Unit, onRetry: ()->Unit) {
    Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.End,verticalArrangement=Arrangement.spacedBy(4.dp)) {
        batch.files.forEachIndexed { index,file ->
            val done=index<progress.index||progress.committing
            val current=index==progress.index
            val total=if(current&&progress.total>0)progress.total else file.size
            val sent=if(done)total else if(current)progress.sent else 0
            val label=when { error.isNotBlank()&&current -> "Не отправлено · Повторить"; progress.committing -> "Отправляем…"; done -> "Загружено · ждёт отправки"; !current -> "В очереди"; total>0 -> "${uploadBytesLabel(sent)} / ${uploadBytesLabel(total)}"; else -> "Подготовка…" }
            Surface(color=Outgoing,shape=RoundedCornerShape(16.dp,16.dp,4.dp,16.dp),modifier=Modifier.widthIn(max=310.dp).fillMaxWidth(.84f)) {
                Column(Modifier.padding(horizontal=10.dp,vertical=8.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Box(Modifier.size(46.dp),contentAlignment=Alignment.Center) {
                            Box(Modifier.size(42.dp).clip(CircleShape).background(Accent.copy(alpha=.24f)))
                            if(busy&&current&&!progress.committing){if(total>0)CircularProgressIndicator(progress={ (sent.toFloat()/total).coerceIn(0f,1f) },modifier=Modifier.size(42.dp).semantics{contentDescription="Загрузка ${file.name}"},color=Accent,trackColor=Accent.copy(alpha=.18f),strokeWidth=2.dp) else CircularProgressIndicator(Modifier.size(42.dp),color=Accent,trackColor=Accent.copy(alpha=.18f),strokeWidth=2.dp)}
                            if(!progress.committing||error.isNotBlank())IconButton(onClick=if(error.isNotBlank())onRetry else onCancel,modifier=Modifier.size(40.dp)){Icon(if(error.isNotBlank())Icons.Outlined.Refresh else Icons.Outlined.Close,if(error.isNotBlank())"Повторить отправку" else "Отменить загрузку",tint=Accent,modifier=Modifier.size(22.dp))}
                            else Icon(Icons.Outlined.Description,null,tint=Accent)
                        }
                        Column(Modifier.weight(1f).padding(start=8.dp)){NativeText(file.name,color=TextMain,fontSize=14.sp,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis);NativeText(label,fontSize=12.sp,color=Accent)}
                    }
                    if(index==0&&!batch.caption.isNullOrBlank())NativeText(batch.caption.orEmpty(),color=TextMain,fontSize=14.sp,modifier=Modifier.padding(top=6.dp))
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){if(error.isNotBlank())TextButton(onClick=onCancel,contentPadding=PaddingValues(0.dp)){NativeText("Убрать",fontSize=12.sp)};Icon(Icons.Outlined.Schedule,"Ожидает отправки",tint=Muted,modifier=Modifier.size(14.dp))}
                }
            }
        }
        if(error.isNotBlank())NativeText(error,Modifier.widthIn(max=310.dp),fontSize=12.sp,color=MaterialTheme.colorScheme.error)
    }
}
