@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
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
import kotlinx.coroutines.flow.collect
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
internal fun NativeTopicsDialog(group: VolnaChat, token: String, api: NativeApi, onDismiss: () -> Unit, onChanged: () -> Unit, navigation: @Composable () -> Unit = {}, onSelect: (Long, Long?) -> Unit) {
    val scope=rememberCoroutineScope(); val context=LocalContext.current
    var info by remember(group.id){mutableStateOf<JSONObject?>(null)}
    var error by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)}
    var editing by remember{mutableStateOf<JSONObject?>(null)};var name by remember{mutableStateOf("")};var description by remember{mutableStateOf("")};var icon by remember{mutableStateOf("")}
    var creation by remember{mutableStateOf(UUID.randomUUID().toString())};var deleting by remember{mutableStateOf<JSONObject?>(null)}
    var revision by remember{mutableStateOf(0)}
    var feed by remember{mutableStateOf(false)};var settings by remember{mutableStateOf(false)}
    suspend fun load(){val value=withContext(Dispatchers.IO){api.topics(token,group.id)};if(info==null&&!value.optBoolean("enabled")&&(value.optJSONArray("topics")?.length()?:0)>0)feed=true;info=value}
    LaunchedEffect(group.id,token){try{load()}catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}}
    LaunchedEffect(group.id,token){MessagingService.signals.collect { event -> if(event.type in listOf("topics","community","chats","history-cleared"))try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){} }}
    LaunchedEffect(group.id,token){MessagingService.events.collect { event ->
        val rows=info?.optJSONArray("topics")
        if(event.message.chatId==group.id || (rows!=null&&(0 until rows.length()).any{rows.getJSONObject(it).getLong("id")==event.message.chatId})) {
            revision++;try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}
        }
    }}
    fun act(path: String,data: JSONObject=JSONObject(),method: String="POST",after: () -> Unit={}) {
        if(busy)return
        scope.launch{busy=true;error="";try{withContext(Dispatchers.IO){api.topicAction(token,group.id,path,data,method)};load();onChanged();after()}
            catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}finally{busy=false}}
    }
    fun edit(topic: JSONObject?){editing=topic?:JSONObject();name=topic?.optString("name").orEmpty();description=topic?.optString("description").orEmpty();icon=topic?.optString("icon").orEmpty();creation=UUID.randomUUID().toString()}
    NativeFullScreen(group.name,onDismiss){
        Row(Modifier.fillMaxSize()) {
        navigation()
        Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(0.dp)) {
            Row { TextButton(onClick={feed=false}){NativeText(if(!feed)"• Темы" else "Темы")};TextButton(onClick={feed=true}){NativeText(if(feed)"• Все сообщения" else "Все сообщения")} }
            if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
            if(busy || info==null&&error.isBlank())LinearProgressIndicator(Modifier.fillMaxWidth())
            info?.let{value ->
                val admin=value.optString("role",group.role) in listOf("owner","admin")
                if(admin) {
                    TextButton(onClick={settings=!settings}){NativeText("Настройки тем")}
                    if(settings) {
                        Row { NativeText("Режим тем",Modifier.weight(1f));Switch(value.optBoolean("enabled"),{act("/settings",JSONObject().put("enabled",it))},enabled=!busy) }
                        NativeText("Выключение режима сохраняет все истории. Доступ к ним — через «Все сообщения».",color=Muted,fontSize=12.sp)
                        NativeText("Кто может создавать темы",fontSize=13.sp)
                        for((key,label) in listOf("owner" to "Только владелец","admins" to "Администраторы","all" to "Все участники"))Row{RadioButton(value.optString("create_policy")==key,{act("/settings",JSONObject().put("create_policy",key))},enabled=!busy);NativeText(label,Modifier.padding(top=12.dp),fontSize=13.sp)}
                    }
                }
                if(feed) NativeForumFeed(group,token,api,revision,onSelect)
                else {
                    val all=nativeTopicRows(value, admin)
                    for(topic in all) {
                        val id=topic.getLong("id");var actions by remember(id){mutableStateOf(false)}
                        NativeTopicRow(topic, busy, { onSelect(id,null) }, { actions=true })
                        if(actions) ModalBottomSheet(onDismissRequest={actions=false},containerColor=Panel) {
                            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
                                NativeText(topic.optString("name"),fontSize=20.sp)
                                var options by remember(id){mutableStateOf(false)}
                                Box {TextButton(enabled=!busy,onClick={options=true}){NativeText(when(topic.optString("notification_mode")){"inherit"->"Уведомления: как в группе";"mentions"->"Упоминания и ответы";"none"->"Без уведомлений";else->"Все сообщения"})};DropdownMenu(options,{options=false}){for((key,label) in listOf("inherit" to "Как в группе","all" to "Все сообщения","mentions" to "Упоминания и ответы","none" to "Без уведомлений").filter{!topic.optBoolean("general")||it.first!="inherit"})DropdownMenuItem(text={NativeText(label)},onClick={options=false;act("/$id/notifications",JSONObject().put("mode",key))})}}
                                TextButton(onClick={val url=BuildConfig.API_BASE_URL.trimEnd('/')+topic.getString("link");context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,url),"Ссылка на тему"))}){NativeText("Поделиться ссылкой")}
                                if(topic.optBoolean("can_manage")) {
                                    Row {TextButton(enabled=!busy,onClick={edit(topic);actions=false}){NativeText("Изменить")};TextButton(enabled=!busy,onClick={act("/$id",JSONObject().put("closed",!topic.optBoolean("closed")),"PATCH")}){NativeText(if(topic.optBoolean("closed"))"Открыть" else "Закрыть")}}
                                    if(admin)TextButton(enabled=!busy,onClick={act("/$id",JSONObject().put("pinned",!topic.optBoolean("pinned")),"PATCH")}){NativeText(if(topic.optBoolean("pinned"))"Открепить" else "Закрепить")}
                                    if(admin&&topic.optBoolean("pinned"))Row {for(delta in listOf(-1,1))TextButton(enabled=!busy,onClick={val pinned=all.filter{it.optBoolean("pinned")}.toMutableList();val i=pinned.indexOfFirst{it.optLong("id")==id};val j=i+delta;if(j in pinned.indices){val other=pinned[j];pinned[j]=pinned[i];pinned[i]=other;act("/reorder",JSONObject().put("ids",org.json.JSONArray(pinned.map{it.getLong("id")})))}}){NativeText(if(delta<0)"Выше" else "Ниже")}}
                                    if(topic.optBoolean("general"))TextButton(enabled=!busy,onClick={act("/$id",JSONObject().put("hidden",!topic.optBoolean("hidden")),"PATCH")}){NativeText(if(topic.optBoolean("hidden"))"Показать общую тему" else "Скрыть общую тему")}
                                    else TextButton(enabled=!busy,onClick={deleting=topic;actions=false}){NativeText("Удалить",color=MaterialTheme.colorScheme.error)}
                                }
                            }
                        }
                    }
                    if(value.optJSONObject("general")?.optBoolean("hidden")==true&&!admin)TextButton(onClick={onSelect(group.id,null)}){NativeText("Открыть общую историю")}
                    if(value.optBoolean("can_create")&&editing==null)Button(onClick={edit(null)},enabled=!busy){NativeText("Создать тему")}
                }
            }
            editing?.let{topic ->
                NativeOutlinedTextField(name,{name=it.take(80)},Modifier.fillMaxWidth(),label={NativeText("Название")},enabled=!busy)
                if(!topic.optBoolean("general")) {
                    NativeOutlinedTextField(description,{description=it.take(1000)},Modifier.fillMaxWidth(),label={NativeText("Описание")},enabled=!busy)
                    NativeOutlinedTextField(icon,{icon=it.take(16)},Modifier.fillMaxWidth(),label={NativeText("Значок / эмодзи")},enabled=!busy)
                }
                Row{Button(enabled=!busy&&name.isNotBlank(),onClick={val data=JSONObject().put("name",name);if(!topic.optBoolean("general"))data.put("description",description).put("icon",icon);if(!topic.has("id"))data.put("client_id",creation);act(if(topic.has("id"))"/${topic.getLong("id")}" else "",data,if(topic.has("id"))"PATCH" else "POST"){editing=null}}){NativeText("Сохранить")};TextButton(enabled=!busy,onClick={editing=null}){NativeText("Отмена")}}
            }
        }
    }
    }
    deleting?.let{topic ->AlertDialog(onDismissRequest={if(!busy)deleting=null},title={NativeText("Удалить тему?")},text={NativeText("«${topic.getString("name") }» и её история будут удалены у всех участников.")},confirmButton={TextButton(enabled=!busy,onClick={act("/${topic.getLong("id")}",method="DELETE"){deleting=null}}){NativeText("Удалить")}},dismissButton={TextButton(enabled=!busy,onClick={deleting=null}){NativeText("Отмена")}})}
}

@Composable
private fun NativeForumFeed(group: VolnaChat, token: String, api: NativeApi, revision: Int, onSelect: (Long,Long?) -> Unit) {
    val scope=rememberCoroutineScope();var messages by remember(group.id){mutableStateOf(emptyList<VolnaMessage>())};var error by remember{mutableStateOf("")};var query by remember{mutableStateOf("")};var more by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
    LaunchedEffect(group.id,token,query,revision) {busy=true;try {delay(250);messages=withContext(Dispatchers.IO){api.forumMessages(token,group.id,query=query)};more=messages.size==50;error=""}catch(cancelled:CancellationException){throw cancelled}catch(e:Exception){error=e.message.orEmpty()}finally{busy=false}}
    NativeOutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={NativeText("Поиск по всем темам")})
    if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
    if(more)TextButton(enabled=!busy,onClick={scope.launch{busy=true;try{val page=withContext(Dispatchers.IO){api.forumMessages(token,group.id,messages.firstOrNull()?.id,query)};messages=(page+messages).distinctBy{it.id};more=page.size==50}catch(cancelled:CancellationException){throw cancelled}catch(e:Exception){error=e.message.orEmpty()}finally{busy=false}}}){NativeText("Ранние сообщения")}
    if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    for(message in messages)Card(Modifier.fillMaxWidth()){Column(Modifier.padding(10.dp)) {
        TextButton(onClick={onSelect(message.chatId,message.id)}){NativeText("${message.topicName.ifBlank{"Общие вопросы"}} ›")}
        NativeText(message.senderName,color=Muted,fontSize=12.sp)
        NativeLinkedText(message.text,entities=message.emojiEntities,token=token)
        message.attachmentName?.let {TextButton(onClick={onSelect(message.chatId,message.id)}){NativeText("📎 $it")}}
    }}
    NativeText("Выберите название темы, чтобы ответить. Просмотр ленты не меняет прочитанность других тем.",color=Muted,fontSize=12.sp)
}

@Composable
internal fun NativeTopicTabs(chat: VolnaChat, token: String, api: NativeApi, onSelect: (Long) -> Unit) {
    val group=chat.parentId.takeIf{it!=0L}?:chat.id
    var info by remember(group){mutableStateOf<JSONObject?>(null)}
    suspend fun load(){info=withContext(Dispatchers.IO){api.topics(token,group)}}
    LaunchedEffect(group,token){try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}}
    LaunchedEffect(group,token){MessagingService.signals.collect{event->if(event.type in listOf("topics","community","chats"))try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}}}
    LaunchedEffect(group,token){MessagingService.events.collect{event->
        val rows=info?.optJSONArray("topics")
        if(event.message.chatId==group || (rows!=null&&(0 until rows.length()).any{rows.getJSONObject(it).getLong("id")==event.message.chatId}))try{load()}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}
    }}
    info?.takeIf{it.optBoolean("enabled")}?.let{value ->
        val rows=value.optJSONArray("topics");val all=(listOfNotNull(value.optJSONObject("general"))+(if(rows==null)emptyList() else (0 until rows.length()).map{rows.getJSONObject(it)})).filter{!it.optBoolean("hidden")}.sortedWith(compareByDescending<JSONObject>{it.optBoolean("pinned")}.thenBy{it.optInt("pin_order")})
        androidx.compose.foundation.lazy.LazyRow(Modifier.fillMaxWidth().padding(horizontal=8.dp)) {items(all.size){i->val topic=all[i];val id=topic.getLong("id");FilterChip(selected=chat.id==id,onClick={onSelect(id)},label={NativeText(topic.getString("name")+topic.optInt("unread_count").takeIf{it>0}?.let{" · $it"}.orEmpty(),fontSize=12.sp)},modifier=Modifier.padding(end=4.dp))}}
    }
}
