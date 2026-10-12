package dev.volna.messenger

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch

@Composable
internal fun NativeInitialProfile(user: VolnaUser, token: String, api: NativeApi, onSaved: (VolnaUser) -> Unit) {
    var first by rememberSaveable(user.id) { mutableStateOf(user.firstName) }
    var last by rememberSaveable(user.id) { mutableStateOf(user.lastName) }
    var nick by rememberSaveable(user.id) { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var available by remember { mutableStateOf(false) }
    var suggestions by remember { mutableStateOf(emptyList<String>()) }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(nick) {
        available = false; suggestions = emptyList(); status = ""
        val value = nick.trim().removePrefix("@").lowercase()
        if (!Regex("[a-z0-9_]{4,32}").matches(value) || value.all { it.isDigit() }) { checking = false; return@LaunchedEffect }
        checking = true
        try {
            delay(350)
            val result = withContext(Dispatchers.IO) { api.checkUsername(token, value) }
            available = result.optBoolean("available")
            status = if (available) "Ник свободен" else result.optString("reason", "Этот ник занят. Выберите вариант или введите другой.")
            val rows = result.optJSONArray("suggestions")
            suggestions = if (rows == null) emptyList() else (0 until rows.length()).map { rows.getString(it) }
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (e: Exception) { status = e.message ?: "Не удалось проверить ник" }
        finally { checking = false }
    }
    // This is the registration step, so dismissing it cannot expose chats with an incomplete profile.
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        NativeText("Добро пожаловать в Волну")
        NativeText("Представьтесь и выберите свой уникальный ник. Имя и фамилия могут совпадать с именами других пользователей.", color = Muted)
        OutlinedTextField(last, { last = it; error = "" }, label = { NativeText("Фамилия") }, singleLine = true, enabled = !saving, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(first, { first = it; error = "" }, label = { NativeText("Имя") }, singleLine = true, enabled = !saving, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(nick, { nick = it; error = "" }, label = { NativeText("Ник") }, prefix = { NativeText("@") }, singleLine = true, enabled = !saving, modifier = Modifier.fillMaxWidth())
        NativeText("4–32 символа: латинские буквы, цифры и _. Ник один на весь сервер.", color = Muted)
        if (checking) NativeText("Проверяем ник…", color = Muted)
        if (status.isNotBlank()) NativeText(status, color = if (available) Accent else Muted)
        suggestions.forEach { suggestion -> TextButton(onClick = { nick = suggestion }, enabled = !saving) { NativeText("@$suggestion") } }
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        Button(enabled = !saving && !checking && available && first.isNotBlank() && last.isNotBlank(), onClick = {
            saving = true; error = ""
            scope.launch {
                try { onSaved(withContext(Dispatchers.IO) { api.completeInitialProfile(token, first, last, nick) }) }
                catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                catch (e: Exception) {
                    error = e.message ?: "Не удалось сохранить профиль"
                    try { val check = withContext(Dispatchers.IO) { api.checkUsername(token, nick) }; available = check.optBoolean("available"); val rows = check.optJSONArray("suggestions"); suggestions = if (rows == null) emptyList() else (0 until rows.length()).map { rows.getString(it) } } catch (_: Exception) { }
                } finally { saving = false }
            }
        }, modifier = Modifier.fillMaxWidth()) { NativeText(if (saving) "Сохраняем…" else "Начать общение") }
    }
}

@Composable
internal fun NativeUpdatesScreen(update: VolnaUpdate?, busy: Boolean, status: String, automatic: Boolean, onAutomatic: (Boolean) -> Unit,idle:Boolean,onIdle:(Boolean)->Unit, ready: Boolean, onCheck: () -> Unit, onInstall: () -> Unit, onLater: () -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    NativeFullScreen("Обновления", onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeText("Волна ${BuildConfig.VERSION_NAME}")
            Row(Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) { NativeText("Скачивать автоматически"); NativeText("Новая версия загружается и проверяется заранее", color = Muted) }
                Switch(checked = automatic, onCheckedChange = onAutomatic, enabled = !busy)
            }
            Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){NativeText("Обновлять при простое");NativeText("После 10 минут с выключенным или заблокированным экраном, без звонков и отправки вложений",color=Muted)};Switch(checked=idle,onCheckedChange=onIdle,enabled=!busy)}
            NativeText("Если Android разрешает, обновление установится автоматически. Иначе подтвердите установку вручную.",color=Muted)
            NativeText("После загрузки выберите: обновить сейчас или при следующем запуске. Android попросит подтвердить установку.", color = Muted)
            if (status.isNotBlank()) NativeText(status)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            OutlinedButton(onClick = onCheck, enabled = !busy) { NativeText("Проверить обновления") }
            if (update != null) {
                NativeText("Доступна Волна ${update.versionName}")
                Button(onClick = onInstall, enabled = !busy) { NativeText(if (ready) "Обновить сейчас" else "Скачать и установить") }
                if (ready) OutlinedButton(onClick = onLater, enabled = !busy) { NativeText("При следующем запуске") }
            }
            TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))) }) { NativeText("Разрешение на установку обновлений") }
        }
    }
}
