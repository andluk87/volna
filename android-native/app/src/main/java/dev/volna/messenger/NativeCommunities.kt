package dev.volna.messenger

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
fun CommunityEntryDialog(mode: String, token: String, api: NativeApi, onDismiss: () -> Unit, onOpen: (Long) -> Unit) {
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf(if (mode == "create-channel") "channel" else "group") }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val clientId = remember { UUID.randomUUID().toString() }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { NativeText(if (mode == "join") "Войти по приглашению" else "Создать сообщество") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (mode == "join") {
                NativeText("Вставьте код или ссылку приглашения", color = Muted, fontSize = 12.sp)
                NativeField(invite, { invite = it }, "Приглашение")
            } else {
                Row { listOf("group" to "Группа", "channel" to "Канал").forEach { (key, label) -> TextButton(onClick = { kind = key }) { NativeText(label, color = if (kind == key) Accent else Muted) } } }
                NativeField(title, { title = it.take(80) }, "Название")
                NativeOutlinedTextField(description, { description = it.take(1000) }, Modifier.fillMaxWidth().padding(top = 12.dp), label = { NativeText("Описание") }, minLines = 2, maxLines = 4)
                NativeText(if (kind == "group") "Все участники могут переписываться" else "Публикации доступны владельцу и администраторам", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 8.dp))
            }
            if (error.isNotBlank()) ErrorBanner(error, Modifier.padding(top = 12.dp))
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = {
        busy = true; error = ""
        scope.launch {
            try {
                val id = withContext(Dispatchers.IO) {
                    if (mode == "join") {
                        val raw = invite.trim()
                        val code = if (raw.matches(Regex("[a-f0-9]{48}"))) raw else Uri.parse(raw).getQueryParameter("invite") ?: Uri.parse(raw).getQueryParameter("token") ?: raw
                        api.joinCommunity(token, code)
                    } else api.createCommunity(token, kind, title.trim(), description.trim(), clientId)
                }
                onOpen(id)
            } catch (problem: Exception) { error = problem.message ?: "Не удалось открыть сообщество" }
            finally { busy = false }
        }
    }) { NativeText(if (busy) "Подождите…" else if (mode == "join") "Войти" else "Создать") } }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { NativeText("Отмена") } })
}

private data class MemberCommand(val action: String, val member: VolnaMember?, val role: String? = null)

@Composable
fun CommunityManageDialog(chat: VolnaChat, me: VolnaUser?, token: String, api: NativeApi, onDismiss: () -> Unit, onChanged: () -> Unit, onLeft: () -> Unit, onOpenAttachment: (VolnaMessage) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    var community by remember(chat.id) { mutableStateOf<VolnaCommunity?>(null) }
    var title by remember(chat.id) { mutableStateOf(chat.name) }
    var description by remember(chat.id) { mutableStateOf("") }
    var postingPolicy by remember(chat.id) { mutableStateOf("all") }
    var section by remember(chat.id) { mutableStateOf("info") }
    var query by remember { mutableStateOf("") }
    var people by remember { mutableStateOf(emptyList<VolnaUser>()) }
    var invite by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<MemberCommand?>(null) }
    suspend fun refresh() {
        val loaded = withContext(Dispatchers.IO) { api.community(token, chat.id) }
        community = loaded; title = loaded.title; description = loaded.description; postingPolicy = loaded.postingPolicy
    }
    fun action(command: MemberCommand) {
        if (busy) return
        busy = true; error = ""
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { api.communityAction(token, chat.id, command.action, command.member?.id, command.role,
                    title = if (command.action == "settings") title else null, description = if (command.action == "settings") description else null,
                    postingPolicy = if (command.action == "settings") postingPolicy else null) }
                if (command.action == "invite") invite = BuildConfig.API_BASE_URL.trimEnd('/') + "/app?invite=" + result.getString("token")
                if (command.action == "revoke-invite") invite = ""
                if (command.action == "leave") { onLeft(); return@launch }
                refresh(); onChanged()
                if (command.action == "add") { query = ""; people = emptyList() }
            } catch (problem: Exception) { error = problem.message ?: "Действие не выполнено" }
            finally { busy = false }
        }
    }
    LaunchedEffect(chat.id, token) { try { refresh() } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить сообщество" } }
    LaunchedEffect(query, community?.members?.size) {
        people = emptyList()
        if (query.trim().length < 2 || community?.canManage != true) return@LaunchedEffect
        delay(300)
        try { people = withContext(Dispatchers.IO) { api.searchPeople(token, query.trim()) }.filter { candidate -> community?.members?.none { it.id == candidate.id } == true } }
        catch (problem: Exception) { error = problem.message ?: "Не удалось найти пользователя" }
    }
    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), color = Ink) {
            Column {
                Row(Modifier.fillMaxWidth().background(Panel).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { NativeText(if (chat.kind == "channel") "Канал" else "Группа", color = Muted, fontSize = 11.sp); NativeText(community?.title ?: chat.name, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
                    IconButton(onClick = onDismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Закрыть") }
                }
                if (community == null && error.isBlank()) CircularProgressIndicator(Modifier.padding(24.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    TextButton(onClick = { section = "info" }) { NativeText("Информация", color = if (section == "info") Accent else Muted) }
                    TextButton(onClick = { section = "media" }) { NativeText("Общие медиа", color = if (section == "media") Accent else Muted) }
                }
                if (section == "media") NativeProfileMedia(chat, token, api, onOpenAttachment, Modifier.weight(1f))
                else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (error.isNotBlank()) ErrorBanner(error)
                    val loaded = community
                    if (loaded != null) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { Avatar(loaded.title, loaded.id, token = token, size = 80.dp) }
                        NativeText("${loaded.memberCount} участников · ${roleLabel(loaded.role)}", color = Muted, fontSize = 12.sp)
                        if (loaded.canManage) {
                            NativeField(title, { title = it.take(80) }, "Название")
                            NativeOutlinedTextField(description, { description = it.take(1000) }, Modifier.fillMaxWidth(), label = { NativeText("Описание") }, minLines = 2, maxLines = 4)
                            if (loaded.kind == "group") Row(verticalAlignment = Alignment.CenterVertically) {
                                NativeText("Пишут только администраторы", Modifier.weight(1f), color = TextMain, fontSize = 13.sp)
                                Switch(postingPolicy == "admins", { postingPolicy = if (it) "admins" else "all" })
                            }
                            TextButton(enabled = !busy, onClick = { action(MemberCommand("settings", null)) }) { NativeText("Сохранить описание") }
                            NativeText("Приглашение", color = Accent)
                            TextButton(enabled = !busy, onClick = { action(MemberCommand("invite", null)) }) { NativeText(if (loaded.invite == null) "Создать ссылку" else "Создать новую ссылку") }
                            if (loaded.invite != null) {
                                NativeText("Использовано ${loaded.invite.optInt("uses")} из ${loaded.invite.optInt("max_uses")}", color = Muted, fontSize = 11.sp)
                                TextButton(enabled = !busy, onClick = { action(MemberCommand("revoke-invite", null)) }) { NativeText("Отозвать приглашение") }
                            }
                            if (invite.isNotBlank()) {
                                NativeText(invite, fontSize = 11.sp)
                                Row { TextButton(onClick = { clipboard.setText(AnnotatedString(invite)) }) { NativeText("Копировать") }
                                    TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, invite), "Поделиться приглашением")) }) { NativeText("Поделиться") } }
                            }
                            NativeField(query, { query = it }, "Добавить по имени, телефону или @username")
                            people.forEach { person -> TextButton(enabled = !busy, onClick = { action(MemberCommand("add", VolnaMember(person.id, person.name, person.username, "member"))) }) { NativeText("Добавить ${person.name} · @${person.username}") } }
                        } else if (loaded.description.isNotBlank()) NativeText(loaded.description)
                        NativeText("Участники", color = Accent, modifier = Modifier.padding(top = 10.dp))
                        loaded.members.forEach { member ->
                            var menu by remember(member.id) { mutableStateOf(false) }
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) { NativeText(member.name, fontSize = 14.sp); NativeText("@${member.username} · ${roleLabel(member.role)}", fontSize = 11.sp, color = Muted) }
                                if (loaded.canManage && member.id != me?.id && member.role != "owner") Box {
                                    IconButton(onClick = { menu = true }, enabled = !busy) { Icon(Icons.Outlined.MoreVert, "Действия участника") }
                                    DropdownMenu(menu, { menu = false }) {
                                        if (loaded.role == "owner") {
                                            DropdownMenuItem(text = { NativeText(if (member.role == "admin") "Снять администратора" else "Назначить администратором") }, onClick = { menu = false; action(MemberCommand("role", member, if (member.role == "admin") "member" else "admin")) })
                                            DropdownMenuItem(text = { NativeText("Передать владение") }, onClick = { menu = false; pending = MemberCommand("transfer", member) })
                                        }
                                        if (loaded.role == "owner" || member.role != "admin") DropdownMenuItem(text = { NativeText("Исключить") }, onClick = { menu = false; pending = MemberCommand("remove", member) })
                                    }
                                }
                            }
                        }
                        if (loaded.members.isEmpty()) NativeText("Список подписчиков доступен администраторам", color = Muted, fontSize = 12.sp)
                        if (loaded.banned.isNotEmpty()) {
                            NativeText("Исключённые", color = Accent)
                            loaded.banned.forEach { member -> TextButton(enabled = !busy, onClick = { action(MemberCommand("unban", member)) }) { NativeText("Снять исключение: ${member.name}") } }
                        }
                        if (loaded.role != "owner") TextButton(enabled = !busy, onClick = { pending = MemberCommand("leave", null) }) { NativeText("Покинуть сообщество", color = MaterialTheme.colorScheme.error) }
                        else NativeText("Чтобы выйти, передайте владение другому участнику", color = Muted, fontSize = 11.sp)
                    }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
    pending?.let { command -> AlertDialog(onDismissRequest = { pending = null }, title = { NativeText(when (command.action) { "transfer" -> "Передать владение?"; "leave" -> "Покинуть сообщество?"; else -> "Исключить участника?" }) },
        text = { NativeText(if (command.action == "transfer") "${command.member?.name} станет владельцем, а вы — администратором." else if (command.action == "leave") "Вы сможете вернуться по новому приглашению." else "${command.member?.name} не сможет вернуться, пока вы не снимете исключение.") },
        confirmButton = { TextButton(onClick = { pending = null; action(command) }) { NativeText("Подтвердить") } }, dismissButton = { TextButton(onClick = { pending = null }) { NativeText("Отмена") } }) }
}
private fun roleLabel(role: String) = when (role) { "owner" -> "Владелец"; "admin" -> "Администратор"; else -> "Участник" }
