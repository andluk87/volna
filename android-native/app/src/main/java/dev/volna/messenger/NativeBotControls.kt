package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
internal fun NativeBotButtons(message: VolnaMessage, token: String, api: NativeApi) {
    if (message.deleted || message.botButtons.isEmpty()) return
    key(message.id, token, message.botButtons) { NativeBotButtonContent(message, token, api) }
}

@Composable
private fun NativeBotButtonContent(message: VolnaMessage, token: String, api: NativeApi) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var alert by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        message.botButtons.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { button ->
                    OutlinedButton(enabled = !busy, modifier = Modifier.weight(1f), contentPadding = PaddingValues(5.dp), onClick = {
                        if (!busy) {
                            busy = true; note = ""
                            if (pending?.first != button.id) pending = button.id to UUID.randomUUID().toString()
                            val nonce = pending!!.second
                            scope.launch {
                                try {
                                    var result = withContext(Dispatchers.IO) { api.botInteraction(token, message.id, button.id, nonce) }
                                    var attempts = 0
                                    while (result.getString("status") == "pending" && attempts++ < 60) {
                                        delay(2000)
                                        val callback = result.getString("callback_id")
                                        result = withContext(Dispatchers.IO) { api.botInteractionStatus(token, callback) }
                                    }
                                    if (result.getString("status") == "answered") {
                                        val answer = result.getJSONObject("answer")
                                        if (answer.optBoolean("show_alert")) alert = answer.optString("text")
                                        else note = answer.optString("text").ifBlank { "Готово" }
                                    } else note = "Бот не ответил вовремя. Можно нажать ещё раз."
                                    pending = null
                                } catch (cancelled: CancellationException) { throw cancelled }
                                catch (problem: Exception) { note = problem.message.orEmpty() }
                                finally { busy = false }
                            }
                        }
                    }) { NativeText(button.text, fontSize = 12.sp) }
                }
            }
        }
        if (busy) NativeText("Ожидаем ответ бота…", fontSize = 11.sp)
        if (note.isNotBlank()) NativeText(note, fontSize = 12.sp)
    }
    if (alert != null) AlertDialog(onDismissRequest = { alert = null }, title = { NativeText("Ответ бота") }, text = { NativeText(alert.orEmpty()) }, confirmButton = { TextButton(onClick = { alert = null }) { NativeText("Закрыть") } })
}

@Composable
internal fun NativeBotCommands(chat: VolnaChat, token: String, api: NativeApi, enabled: Boolean, onChoose: (String) -> Unit) {
    var commands by remember(chat.id, token) { mutableStateOf(emptyList<NativeBotCommand>()) }
    var expanded by remember(chat.id, token) { mutableStateOf(false) }
    var revision by remember(chat.id, token) { mutableStateOf(0) }
    var error by remember(chat.id, token) { mutableStateOf("") }
    LaunchedEffect(chat.id, token, revision) {
        try { commands = withContext(Dispatchers.IO) { api.botCommands(token, chat.id) }; error = "" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message.orEmpty() }
    }
    if (commands.isNotEmpty()) Box(Modifier.padding(horizontal = 12.dp)) {
        TextButton(enabled = enabled, onClick = { expanded = !expanded; revision++ }) { NativeText("Команды") }
        DropdownMenu(expanded, { expanded = false }, modifier = Modifier.heightIn(max = 280.dp)) {
            if (error.isNotBlank()) DropdownMenuItem(text = { NativeText(error) }, onClick = { revision++ })
            commands.forEach { command ->
                val value = "/" + command.command + if (chat.kind == "group") "@" + command.username else ""
                DropdownMenuItem(text = { Column { NativeText(value); NativeText(command.description, fontSize = 12.sp) } }, onClick = { expanded = false; onChoose(value) })
            }
        }
    }
}
