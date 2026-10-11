package dev.volna.messenger

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun NativeFolderShare(folder: NativeFolder, chats: List<VolnaChat>, token: String, api: NativeApi) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val eligible = chats.filter { it.kind in listOf("group", "channel") && it.role in listOf("owner", "admin") && nativeFolderMatches(folder, it) }
    var selected by remember(folder.id) { mutableStateOf(emptySet<Long>()) }
    var link by remember(folder.id) { mutableStateOf("") }
    var inviteId by remember(folder.id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val path = "/folders/${folder.id}/invites"
    NativeText("Поделиться папкой")
    NativeText("В ссылку попадут только выбранные группы и каналы, которыми вы управляете. Срок — 7 дней.", color = Muted)
    eligible.forEach { chat -> Row { Checkbox(chat.id in selected, { selected = if (it) selected + chat.id else selected - chat.id }, enabled = !busy); NativeText(chat.name) } }
    TextButton(enabled = !busy && selected.isNotEmpty(), onClick = {
        busy = true; error = ""
        scope.launch { try {
            val result = withContext(Dispatchers.IO) { api.contactRequest(path, token, JSONObject().put("chats", JSONArray(selected.toList()))) }
            inviteId = result.getString("id"); link = BuildConfig.API_BASE_URL.trimEnd('/') + "/app?folder_invite=" + result.getString("token")
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false } }
    }) { NativeText("Создать ссылку-приглашение") }
    if (link.isNotEmpty()) {
        NativeOutlinedTextField(link, {}, readOnly = true, label = { NativeText("Ссылка") }, modifier = Modifier.fillMaxWidth())
        Row {
            TextButton(onClick = { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Приглашение в папку", link)) }) { NativeText("Копировать") }
            TextButton(enabled = !busy, onClick = { busy = true; scope.launch { try { withContext(Dispatchers.IO) { api.contactRequest("$path/$inviteId", token, JSONObject()) }; link = "" } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { error = e.message.orEmpty() } finally { busy = false } } }) { NativeText("Отозвать") }
        }
    }
    if (error.isNotEmpty()) NativeText(error, color = MaterialTheme.colorScheme.error)
}

@Composable
internal fun NativeJoinFolder(token: String, api: NativeApi, onDismiss: () -> Unit, onJoined: () -> Unit) {
    val scope = rememberCoroutineScope()
    var raw by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var version by remember { mutableStateOf(0L) }
    var selected by remember { mutableStateOf(emptySet<Long>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { NativeText(preview?.optString("name") ?: "Приглашение в папку") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (preview == null) NativeOutlinedTextField(raw, { raw = it }, label = { NativeText("Ссылка-приглашение") })
            else {
                NativeText("Вы вступите в выбранные группы и каналы. Они появятся в новой папке.")
                val chats = preview!!.getJSONArray("chats")
                for (i in 0 until chats.length()) { val chat = chats.getJSONObject(i); val id = chat.getLong("id"); Row { Checkbox(id in selected, { selected = if (it) selected + id else selected - id }, enabled = !busy); NativeText(chat.getString("name") + if (chat.optBoolean("joined")) " · Уже участник" else "") } }
            }
            if (error.isNotEmpty()) NativeText(error, color = MaterialTheme.colorScheme.error)
        }
    }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { NativeText("Отмена") } }, confirmButton = {
        TextButton(enabled = !busy && (preview == null && raw.isNotBlank() || selected.isNotEmpty()), onClick = {
            busy = true; error = ""; scope.launch { try {
                if (preview == null) {
                    val value = raw.trim(); invite = if (value.matches(Regex("[a-f0-9]{48}"))) value else Uri.parse(value).getQueryParameter("folder_invite").orEmpty()
                    require(invite.matches(Regex("[a-f0-9]{48}"))) { "Проверьте ссылку-приглашение" }
                    preview = withContext(Dispatchers.IO) { api.contactRequest("/folder-invites/$invite", token) }
                    version = withContext(Dispatchers.IO) { api.folders(token) }.getLong("version")
                    val chats = preview!!.getJSONArray("chats"); selected = (0 until chats.length()).map { chats.getJSONObject(it).getLong("id") }.toSet()
                } else { withContext(Dispatchers.IO) { api.contactRequest("/folder-invites/$invite", token, JSONObject().put("version", version).put("chats", JSONArray(selected.toList()))) }; onJoined() }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { error = e.message.orEmpty(); if (e is NativeApiException && e.status == 409) version = withContext(Dispatchers.IO) { api.folders(token) }.getLong("version") } finally { busy = false } }
        }) { NativeText(if (preview == null) "Посмотреть" else "Добавить папку") }
    })
}
