package dev.volna.messenger

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.UUID

internal fun nativeProfileUrl(username: String) = BuildConfig.API_BASE_URL.trimEnd('/') + "/" + username

@Composable
internal fun NativeUsernameEditor(user: VolnaUser, token: String, api: NativeApi, onSaved: (VolnaUser) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var value by remember(user.username) { mutableStateOf(user.username) }; var result by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    LaunchedEffect(value, token) {
        result = null; error = ""; delay(300)
        try { result = withContext(Dispatchers.IO) { api.checkUsername(token,value) } }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        NativeText("Изменить username", fontSize = 18.sp)
        NativeOutlinedTextField(value,{value=it.take(33)},Modifier.fillMaxWidth(),label={NativeText("@username")},singleLine=true,enabled=!busy)
        NativeText("4–32 символа: латинские буквы, цифры и _. Ник не используется для входа.",color=Muted,fontSize=12.sp)
        if (user.phone.isNotBlank() && (user.username == user.phone.filter { it.isDigit() } || user.username.startsWith(user.phone.filter { it.isDigit() } + "_"))) NativeText("Первоначальный ник содержит ваш номер телефона. Измените его, чтобы убрать номер из публичной ссылки.",color=Muted,fontSize=13.sp)
        result?.let { r ->
            NativeText(r.optString("reason").ifBlank { "@${r.optString("username")} ${if(r.optBoolean("available")) "доступен" else "уже занят"}" },color=if(r.optBoolean("available")) Accent else Muted)
            r.optJSONArray("suggestions")?.let { rows -> for(i in 0 until rows.length()) TextButton(onClick={value=rows.getString(i)},enabled=!busy){NativeText("@${rows.getString(i)}")} }
        }
        if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
        Button(enabled=!busy&&result?.optBoolean("available")==true&&result?.optString("username")!=user.username,onClick={scope.launch {
            busy=true;error="";try{val updated=withContext(Dispatchers.IO){api.changeUsername(token,value)};onSaved(updated);value=updated.username}
            catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty();result=withContext(Dispatchers.IO){runCatching{api.checkUsername(token,value)}.getOrNull()}}finally{busy=false}
        }}){NativeText(if(busy)"Сохраняем…" else "Сохранить username")}
        NativeText(nativeProfileUrl(user.username),Modifier.fillMaxWidth().clickable { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(nativeProfileUrl(user.username)))) },color=Accent,fontSize=13.sp)
    }
}

@Composable
internal fun NativeTopicsDialog(group: VolnaChat, token: String, api: NativeApi, onDismiss: () -> Unit, onChanged: () -> Unit, onSelect: (Long) -> Unit) {
    val scope=rememberCoroutineScope();var info by remember(group.id){mutableStateOf<JSONObject?>(null)}
    var error by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)}
    var editing by remember{mutableStateOf<JSONObject?>(null)};var name by remember{mutableStateOf("")};var description by remember{mutableStateOf("")};var icon by remember{mutableStateOf("")}
    var creation by remember{mutableStateOf(UUID.randomUUID().toString())};var deleting by remember{mutableStateOf<JSONObject?>(null)}
    suspend fun load(){info=withContext(Dispatchers.IO){api.topics(token,group.id)}}
    LaunchedEffect(group.id,token){while(true){try{load()}catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()};delay(5000)}}
    fun act(path: String,data: JSONObject=JSONObject(),method: String="POST",after: () -> Unit={}) {
        if(busy)return
        scope.launch{busy=true;error="";try{withContext(Dispatchers.IO){api.topicAction(token,group.id,path,data,method)};load();onChanged();after()}
            catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}finally{busy=false}}
    }
    fun edit(topic: JSONObject?){editing=topic?:JSONObject();name=topic?.optString("name").orEmpty();description=topic?.optString("description").orEmpty();icon=topic?.optString("icon").orEmpty();creation=UUID.randomUUID().toString()}
    NativeFullScreen("Подтемы · ${group.name}",onDismiss){
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            TextButton(onClick={onSelect(group.id)}){NativeText("Общий чат")}
            if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
            if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
            info?.let{value ->
                if(value.optString("role",group.role) in listOf("owner","admin")){
                    NativeText("Кто может создавать подтемы")
                    for((key,label) in listOf("owner" to "Только владелец","admins" to "Владелец и администраторы","all" to "Все участники"))Row{RadioButton(value.optString("create_policy")==key,{act("/settings",JSONObject().put("create_policy",key))},enabled=!busy);NativeText(label,Modifier.padding(top=12.dp))}
                }
                val rows=value.optJSONArray("topics")
                if(rows!=null)for(i in 0 until rows.length()){
                    val topic=rows.getJSONObject(i);val id=topic.getLong("id")
                    Card(Modifier.fillMaxWidth()) {Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        TextButton(onClick={onSelect(id)},modifier=Modifier.fillMaxWidth()) {NativeText("${topic.optString("icon").ifBlank{"#"}}  ${topic.getString("name")}",Modifier.weight(1f));val count=topic.optInt("unread_count");if(count>0)Badge{NativeText(count.toString())}}
                        if(topic.optBoolean("closed"))NativeText("Подтема закрыта",color=Muted,fontSize=12.sp)
                        if(topic.optString("description").isNotBlank())NativeText(topic.getString("description"),color=Muted,fontSize=13.sp)
                        NativeText("Уведомления",fontSize=13.sp)
                        var options by remember(id){mutableStateOf(false)}
                        Box {TextButton(enabled=!busy,onClick={options=true}){NativeText(when(topic.optString("notification_mode")){"mentions"->"Только упоминания";"none"->"Без уведомлений";else->"Все сообщения"})};DropdownMenu(options,{options=false}){for((key,label) in listOf("all" to "Все сообщения","mentions" to "Только упоминания","none" to "Без уведомлений"))DropdownMenuItem(text={NativeText(label)},onClick={options=false;act("/$id/notifications",JSONObject().put("mode",key))})}}
                        if(topic.optBoolean("can_manage"))Row(horizontalArrangement=Arrangement.spacedBy(4.dp)){
                            TextButton(enabled=!busy,onClick={edit(topic)}){NativeText("Изменить")}
                            TextButton(enabled=!busy,onClick={act("/$id",JSONObject().put("closed",!topic.optBoolean("closed")),"PATCH")}){NativeText(if(topic.optBoolean("closed"))"Открыть" else "Закрыть")}
                            TextButton(enabled=!busy,onClick={deleting=topic}){NativeText("Удалить",color=MaterialTheme.colorScheme.error)}
                        }
                    }}
                }
                if(value.optBoolean("can_create")&&editing==null)Button(onClick={edit(null)},enabled=!busy){NativeText("Создать подтему")}
            }
            editing?.let{topic ->
                NativeOutlinedTextField(name,{name=it.take(80)},Modifier.fillMaxWidth(),label={NativeText("Название")},enabled=!busy)
                NativeOutlinedTextField(description,{description=it.take(1000)},Modifier.fillMaxWidth(),label={NativeText("Описание")},enabled=!busy)
                NativeOutlinedTextField(icon,{icon=it.take(16)},Modifier.fillMaxWidth(),label={NativeText("Иконка / эмодзи")},enabled=!busy)
                Row{Button(enabled=!busy&&name.isNotBlank(),onClick={val data=JSONObject().put("name",name).put("description",description).put("icon",icon);if(!topic.has("id"))data.put("client_id",creation);act(if(topic.has("id"))"/${topic.getLong("id")}" else "",data,if(topic.has("id"))"PATCH" else "POST"){editing=null}}){NativeText("Сохранить")};TextButton(enabled=!busy,onClick={editing=null}){NativeText("Отмена")}}
            }
        }
    }
    deleting?.let{topic ->AlertDialog(onDismissRequest={if(!busy)deleting=null},title={NativeText("Удалить подтему?")},text={NativeText("«${topic.getString("name") }» и её история будут удалены у всех участников.")},confirmButton={TextButton(enabled=!busy,onClick={act("/${topic.getLong("id")}",method="DELETE"){deleting=null}}){NativeText("Удалить")}},dismissButton={TextButton(enabled=!busy,onClick={deleting=null}){NativeText("Отмена")}})}
}
