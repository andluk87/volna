package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
internal fun NativeCallPrivacyScreen(token: String, api: NativeApi, onDismiss: () -> Unit) {
    NativeFullScreen("Звонки", onDismiss) { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) { NativeCallPrivacy(token, api) } }
}

@Composable
internal fun NativeCallPrivacy(token: String, api: NativeApi, peer: Long? = null) {
    var policy by remember(token, peer) { mutableStateOf<JSONObject?>(null) }
    var relay by remember(token) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var retry by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(token, peer, retry) {
        try { val loaded = withContext(Dispatchers.IO) { api.contactRequest("/calls/privacy", token) to api.callConfig(token) }; policy = loaded.first; relay = loaded.second.optBoolean("relayConfigured"); error = "" }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() }
    }
    fun save(path: String, data: JSONObject) { scope.launch { busy = true; error = ""; try { policy = withContext(Dispatchers.IO) { api.contactRequest(path, token, data) } } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false } } }
    Column(Modifier.fillMaxWidth().padding(horizontal = if(peer == null)0.dp else 16.dp)) {
        val loaded = policy
        if (loaded != null) {
            val list = loaded.optJSONArray("blocked")
            val blocked = (0 until (list?.length() ?: 0)).mapNotNull { list?.optJSONObject(it) }
            if(peer != null) { val isBlocked = blocked.any { it.optLong("id") == peer }; TextButton(enabled = !busy, onClick = { save("/calls/blocks/$peer", JSONObject().put("blocked", !isBlocked)) }) { NativeText(if(isBlocked)"Разрешить звонки от пользователя" else "Заблокировать звонки пользователя") } }
            else {
                NativeText("Кто может мне звонить", color = Accent)
                for ((value, label) in listOf("everyone" to "Все", "contacts" to "Мои контакты", "nobody" to "Никто")) Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(selected = loaded.optString("allow_calls") == value, enabled = !busy, onClick = { save("/calls/privacy", JSONObject().put("allow_calls", value).put("relay_only", true)) }); NativeText(label) }
                NativeText("Все звонки — только через сервер TURN. Прямое соединение отключено." + if(!relay)" Сервер TURN пока не настроен — звонки недоступны." else "", color = Muted)
                if(blocked.isNotEmpty()) { Spacer(Modifier.height(16.dp)); NativeText("Звонки заблокированы", color = Accent); for(user in blocked)TextButton(enabled = !busy, onClick = { save("/calls/blocks/${user.optLong("id")}", JSONObject().put("blocked", false)) }) { NativeText(user.optString("name") + " — разблокировать") } }
            }
        }
        if(error.isNotBlank()) { NativeText(error, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }) { NativeText("Повторить") } }
    }
}
