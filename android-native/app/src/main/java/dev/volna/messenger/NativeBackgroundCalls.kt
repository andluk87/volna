package dev.volna.messenger

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.material3.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal data class NativeAccountIncoming(val account:Long,val name:String,val call:VolnaCall)
internal object NativeBackgroundCalls {
 val calls=MutableStateFlow<Map<Long,NativeAccountIncoming>>(emptyMap())
 fun put(account:Long,name:String,call:VolnaCall){calls.update{it+(account to NativeAccountIncoming(account,name,call))}}
 fun remove(account:Long){calls.update{it-account}}
}
@Composable
internal fun NativeBackgroundCallHost(api:NativeApi) {
 val pending by NativeBackgroundCalls.calls.collectAsState()
 val current by NativeCalls.state.collectAsState()
 val context=LocalContext.current;val scope=rememberCoroutineScope()
 var dismissed by remember{mutableStateOf(setOf<String>())}
 val incoming=pending.values.firstOrNull{it.call.id !in dismissed && it.call.id!=current.call?.id}?:return
 val busy=current.call!=null
 AlertDialog(onDismissRequest={dismissed=dismissed+incoming.call.id},title={NativeText(incoming.call.peer?.name?:"Входящий звонок")},text={NativeText("Аккаунт: ${incoming.name}"+if(busy)"\nСначала завершите текущий звонок" else if(incoming.call.video)"\nВходящий видеозвонок" else "\nВходящий аудиозвонок")},confirmButton={TextButton(enabled=!busy,onClick={
  context.startActivity(IncomingCallActivity.intent(context,incoming.call.id,incoming.account,true))
  dismissed=dismissed+incoming.call.id
 }){NativeText("Ответить")}},dismissButton={TextButton(onClick={scope.launch{
  try{withContext(Dispatchers.IO){val device=context.getSharedPreferences("volna-native",Context.MODE_PRIVATE).getString("call_device",null)?:"0".repeat(32);api.callAction(NativeCredentials.access(incoming.account),device,incoming.call.id,"end")};NativeBackgroundCalls.remove(incoming.account)}catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){}
 }}){NativeText("Отклонить")}})
}
