@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun NativeProfileDialog(userId: Long, currentUser: VolnaUser?, token: String, api: NativeApi,
    onDismiss: () -> Unit, onSaved: (VolnaUser) -> Unit, chats: List<VolnaChat>,
    onStartChat: (VolnaUser, Boolean) -> Unit, onOpenChat: (VolnaChat, Boolean) -> Unit,
    onCall: (VolnaChat) -> Unit, onVideo: (VolnaChat) -> Unit, onMute: (VolnaChat) -> Unit, onOpenAttachment: (VolnaMessage) -> Unit, cache: NativeCache,
    onAppearance: ((VolnaChat) -> Unit)? = null, refresh: Int = 0
) {
    val context = LocalContext.current
    var profile by remember(userId) { mutableStateOf(if (userId == currentUser?.id) currentUser else null) }
    var error by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("info") }
    var retry by remember { mutableStateOf(0) }
    val contactNames = rememberNativeContactNames(currentUser?.id ?: 0)
    val own = userId == currentUser?.id
    val chat = chats.firstOrNull { it.kind == "direct" && it.peerId == userId } ?: if (own) chats.firstOrNull { it.saved } else null
    LaunchedEffect(userId, token, retry, refresh) {
        val account = currentUser?.id ?: 0
        if (profile == null) profile = withContext(Dispatchers.IO) { cache.profile(account, userId) ?: cache.contacts(account).firstOrNull { it.id == userId } }
        try { val fresh = withContext(Dispatchers.IO) { api.userProfile(token, userId) }; profile = fresh; withContext(Dispatchers.IO) { cache.saveProfile(account, fresh) }; error = "" }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить профиль" }
    }
    NativeFullScreen(if (own) "Мой профиль" else "Профиль", onDismiss) {
        val loaded = profile
        if (error.isNotBlank()) NativeConnectionNotice(error) { retry++ }
        if (loaded == null) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { if (error.isBlank()) CircularProgressIndicator() }
        else {
            Column(Modifier.fillMaxWidth().background(Panel).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(loaded.name, loaded.id, loaded.avatarUrl, token, size = 88.dp)
                NativeText(contactNames[userId] ?: loaded.name, color = TextMain, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
                NativeText("@${loaded.username}", Modifier.clickable { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse(nativeProfileUrl(loaded.username)))) }, color = Accent, fontSize = 14.sp)
                if(own && loaded.phone.isNotBlank() && loaded.username.startsWith(loaded.phone.filter { it.isDigit() })) NativeText("Ник содержит ваш номер. Измените username в профиле.",Modifier.clickable { editing=true },color=Muted,fontSize=12.sp)
                if (!own && loaded.online) NativeText("в сети", color = Accent, fontSize = 12.sp)
                if (own) TextButton(onClick = { editing = true }) { Icon(Icons.Outlined.Edit, null); NativeText("Редактировать профиль", Modifier.padding(start = 8.dp)) }
                else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    ProfileAction(Icons.Outlined.ChatBubbleOutline, "Написать", Modifier.weight(1f)) { if (chat != null) onOpenChat(chat, false) else onStartChat(loaded, false) }
                    ProfileAction(Icons.Outlined.Call, "Позвонить", Modifier.weight(1f)) { if (chat != null) onCall(chat) else onStartChat(loaded, true) }
                    if (chat != null) ProfileAction(Icons.Outlined.Videocam, "Видео", Modifier.weight(1f)) { onVideo(chat) }
                    if (chat != null) ProfileAction(if (chat.muted) Icons.Outlined.NotificationsOff else Icons.Outlined.NotificationsNone, "Уведомления", Modifier.weight(1f)) { onMute(chat) }
                    if (chat != null) ProfileAction(Icons.Outlined.Search, "Поиск", Modifier.weight(1f)) { onOpenChat(chat, true) }
                }
            }
            if (own) NativePhoneChange(loaded, token, api) { profile = it; onSaved(it) }
            if (!own) NativePrivateContactName(currentUser?.id ?: 0, userId, token, api) { retry++ }
            Row(Modifier.fillMaxWidth().background(Panel), horizontalArrangement = Arrangement.SpaceEvenly) {
                TextButton(onClick = { tab = "info" }) { NativeText("Информация", color = if (tab == "info") Accent else Muted) }
                if (chat != null) TextButton(onClick = { tab = "media" }) { NativeText("Общие медиа", color = if (tab == "media") Accent else Muted) }
            }
            if (tab == "media" && chat != null) NativeProfileMedia(chat, token, api, onOpenAttachment, Modifier.weight(1f))
            else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (chat != null && onAppearance != null) NativeSettingsCard { NativeSettingRow(Icons.Outlined.Palette, "Изменить оформление", "Тема этой переписки") { onAppearance(chat) } }
                NativeSettingsCard { Column(Modifier.padding(16.dp)) { NativeText("О себе", color = Accent, fontSize = 12.sp); NativeText(loaded.bio.ifBlank { "Пока без описания" }, color = if (loaded.bio.isBlank()) Muted else TextMain, fontSize = 15.sp, modifier = Modifier.padding(top = 6.dp)) } }
                if (own && loaded.phone.isNotBlank()) NativeSettingsCard { NativeText("Телефон: ${loaded.phone} · подтверждён", Modifier.padding(16.dp), color = Muted) }
                if (chat == null && !own) NativeText("После начала диалога здесь будут доступны общие медиа и поиск в переписке.", color = Muted, fontSize = 13.sp)
            }
        }
    }
    if (editing) NativeProfileEditor(userId, currentUser, token, api, { editing = false }) { updated -> profile = updated; onSaved(updated) }
}

@Composable
private fun ProfileAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(icon, label, tint = Accent, modifier = Modifier.size(24.dp)); NativeText(label, color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp)) }
}

@Composable
internal fun NativeProfileMedia(chat: VolnaChat, token: String, api: NativeApi, onOpen: (VolnaMessage) -> Unit, modifier: Modifier = Modifier) {
    var type by remember(chat.id) { mutableStateOf("media") }
    var rows by remember(chat.id) { mutableStateOf(emptyList<VolnaMessage>()) }
    var busy by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var retry by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(chat.id, type, token, retry) {
        busy = true; rows = emptyList(); more = false
        try { val page = withContext(Dispatchers.IO) { api.gallery(token, chat.id, type = type) }; rows = page; more = page.size == 50; error = "" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (problem: Exception) { error = problem.message ?: "Медиа недоступны" }
        finally { busy = false }
    }
    fun older() {
        if (busy || !more) return
        val selectedType = type; busy = true
        scope.launch { try { val page = withContext(Dispatchers.IO) { api.gallery(token, chat.id, rows.lastOrNull()?.id, selectedType) }; if (type == selectedType) { rows = (rows + page).distinctBy { it.id }; more = page.size == 50 && rows.size < 1000; error = "" } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { error = problem.message ?: "Не удалось загрузить медиа" }
            finally { if (type == selectedType) busy = false } }
    }
    Column(modifier.fillMaxWidth()) {
        LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { items(listOf("media" to "Медиа", "files" to "Файлы", "links" to "Ссылки", "voice" to "Голосовые", "animations" to "Анимации")) { (key, label) -> FilterChip(type == key, { type = key }, label = { NativeText(label, fontSize = 12.sp) }) } }
        if (error.isNotBlank()) NativeConnectionNotice(error) { retry++ }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (rows.isEmpty() && !busy && error.isBlank()) NativeEmptyState(Icons.Outlined.PhotoLibrary, "Медиафайлов пока нет")
        else if (type in listOf("media", "animations")) LazyVerticalGrid(columns = GridCells.Adaptive(110.dp), modifier = Modifier.weight(1f), contentPadding = PaddingValues(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(rows, key = { it.id }) { message -> AttachmentThumbnail(message, token, { onOpen(message) }, Modifier.fillMaxWidth().aspectRatio(1f)) }
            if (more) item { TextButton(onClick = ::older, enabled = !busy) { NativeText("Ещё") } }
        } else LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.id }) { message -> Column(Modifier.fillMaxWidth().clickable { if (message.attachmentId != null) onOpen(message) }.padding(16.dp)) {
                if (type == "links") NativeLinkedText(message.text)
                else Row(verticalAlignment = Alignment.CenterVertically) { Icon(if (type == "voice") Icons.Outlined.GraphicEq else Icons.Outlined.Description, null, tint = Accent); NativeText(message.attachmentName.orEmpty(), color = TextMain, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp)) }
                NativeText(nativeDay(message.createdAt) + " · " + message.senderName, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp))
            } }
            if (more) item { TextButton(onClick = ::older, enabled = !busy, modifier = Modifier.fillMaxWidth()) { NativeText("Загрузить ещё") } }
        }
    }
}

@Composable
internal fun NativeShareSheet(kind: String, token: String, api: NativeApi, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var latitude by remember { mutableStateOf("") }
    var longitude by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var contacts by remember { mutableStateOf(emptyList<VolnaUser>()) }
    var loading by remember { mutableStateOf(false) }
    fun locate() {
        if (loading) return
        loading = true; error = ""
        scope.launch {
            try { val location = nativeCurrentLocation(context); latitude = location.latitude.toString(); longitude = location.longitude.toString() }
            catch (_: kotlinx.coroutines.TimeoutCancellationException) { error = "Определение места заняло слишком долго. Повторите попытку или укажите координаты." }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { error = problem.message ?: "Не удалось определить местоположение" }
            finally { loading = false }
        }
    }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        if (permissions.values.any { it }) locate() else error = "Разрешите доступ к местоположению или укажите координаты вручную"
    }
    LaunchedEffect(kind, token) { if (kind == "contact") { loading = true; try { contacts = withContext(Dispatchers.IO) { api.contacts(token) } } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Контакты недоступны" } finally { loading = false } } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Panel) {
        NativeText(if (kind == "contact") "Поделиться контактом" else "Местоположение", Modifier.padding(16.dp), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        if (kind == "contact") LazyColumn(Modifier.heightIn(max = 350.dp)) { if (loading) item { CircularProgressIndicator(Modifier.padding(16.dp)) }; if (contacts.isEmpty() && !loading) item { NativeText("Сначала начните диалог с пользователем", Modifier.padding(16.dp), color = Muted) }; items(contacts, key = { it.id }) { person -> TextButton(onClick = { onSend("Контакт: ${person.name}\n@${person.username}") }, modifier = Modifier.fillMaxWidth()) { NativeText("${person.name} · @${person.username}", color = TextMain) } } }
        else Column(Modifier.padding(horizontal = 16.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            NativeText("Выберите своё текущее место или укажите координаты. Место отправится только после нажатия кнопки отправки.", color = Muted, fontSize = 13.sp)
            OutlinedButton(onClick = { locationPermission.launch(arrayOf(android.Manifest.permission.ACCESS_COARSE_LOCATION, android.Manifest.permission.ACCESS_FINE_LOCATION)) }, enabled = !loading, modifier = Modifier.fillMaxWidth()) { if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.MyLocation, null); NativeText(if (loading) "Определяем место…" else "Моё местоположение", Modifier.padding(start = 8.dp)) }
            NativeOutlinedTextField(latitude, { latitude = it }, label = { NativeText("Широта") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal))
            NativeOutlinedTextField(longitude, { longitude = it }, label = { NativeText("Долгота") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal))
            Button(onClick = { val lat = latitude.replace(',', '.').toDoubleOrNull(); val lon = longitude.replace(',', '.').toDoubleOrNull(); if (lat == null || lon == null || lat !in -90.0..90.0 || lon !in -180.0..180.0) error = "Проверьте широту и долготу" else onSend("Местоположение\nhttps://www.openstreetmap.org/?mlat=$lat&mlon=$lon#map=16/$lat/$lon") }, modifier = Modifier.fillMaxWidth()) { NativeText("Отправить место") }
        }
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
        Spacer(Modifier.height(24.dp))
    }
}
