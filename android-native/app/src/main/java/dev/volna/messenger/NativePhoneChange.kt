package dev.volna.messenger

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
internal fun NativePhoneChange(user: VolnaUser, token: String, api: NativeApi, onSaved: (VolnaUser) -> Unit) {
    var open by remember { mutableStateOf(false) }; var phone by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
    var challenge by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    TextButton(onClick = { open = true; phone = ""; code = ""; challenge = ""; error = "" }) { NativeText("Изменить номер телефона") }
    if (open) AlertDialog(onDismissRequest = { if (!busy) open = false }, title = { NativeText("Изменить номер телефона") }, text = { Column {
        NativeText("Переписки и контакты останутся в этом аккаунте. Существующий аккаунт другого номера перенести или объединить нельзя.")
        if (challenge.isBlank()) NativeOutlinedTextField(phone, { phone = it }, label = { NativeText("Новый номер с кодом страны") }, enabled = !busy)
        else { NativeText("Код отправлен на $phone"); NativeOutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { NativeText("Код из SMS") }, enabled = !busy) }
        if (error.isNotBlank()) NativeText(error)
    } }, confirmButton = { TextButton(enabled = !busy && (challenge.isBlank() || code.length == 6), onClick = { scope.launch {
        busy = true; error = ""
        try {
            if (challenge.isBlank()) { val normalized = nativeContactPhone(phone, "RU") ?: error("Проверьте номер телефона"); val result = withContext(Dispatchers.IO) { api.contactRequest("/auth/phone/change/request", token, JSONObject().put("phone", normalized)) }; phone = normalized; challenge = result.getString("sms_session_id") }
            else { val result = withContext(Dispatchers.IO) { api.contactRequest("/auth/phone/change/verify", token, JSONObject().put("sms_session_id", challenge).put("code", code)) }; onSaved(api.contactUser(result.getJSONObject("user"))); open = false }
        } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } finally { busy = false }
    } }) { NativeText(if (busy) "Подождите…" else if (challenge.isBlank()) "Отправить SMS" else "Подтвердить") } }, dismissButton = { TextButton(enabled = !busy, onClick = { open = false }) { NativeText("Отмена") } })
}
