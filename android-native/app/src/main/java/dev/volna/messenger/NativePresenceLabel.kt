package dev.volna.messenger
import androidx.compose.runtime.*
import kotlinx.coroutines.delay
@Composable internal fun nativePresenceLabel(online: Boolean, lastSeen: Long): String {
 var now by remember { mutableStateOf(System.currentTimeMillis()) }
 LaunchedEffect(online,lastSeen) { while(!online && lastSeen>0) { now=System.currentTimeMillis();delay(5000) } }
 if(online)return "в сети"
 if(lastSeen<=0)return "Время посещения недоступно"
 val age=(now-lastSeen).coerceAtLeast(0)
 return when { age<5000 -> "был(а) только что";age<60000 -> "был(а) ${age/1000} сек. назад";age<3600000 -> "был(а) ${age/60000} мин. назад";else -> "был(а) "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(lastSeen)) }
}
