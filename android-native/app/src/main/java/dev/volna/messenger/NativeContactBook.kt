@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.i18n.phonenumbers.PhoneNumberUtil
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

internal class NativeContactBook(context: Context, account: Long) {
    val prefs = context.getSharedPreferences("volna-contact-book-$account", Context.MODE_PRIVATE)
    val device: String get() = prefs.getString("device", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device", it).apply() }
    fun cached(): JSONObject {
        val book = runCatching { JSONObject(prefs.getString("book", "{}")!!) }.getOrDefault(JSONObject())
        val rows = book.optJSONArray("contacts") ?: JSONArray(); val queue = pending()
        for (i in 0 until queue.length()) { val item = queue.getJSONObject(i); for (j in 0 until rows.length()) { val row = rows.getJSONObject(j); if (row.optString("contact_id") == item.optString("id")) { val name = item.optString("custom_name"); row.put("custom_name", name).put("display_name", name.ifBlank { row.optString("phonebook_name").ifBlank { row.optJSONObject("user")?.optString("profile_name").orEmpty().ifBlank { row.optJSONObject("user")?.optString("name").orEmpty() } } }) } } }
        return book
    }
    fun save(book: JSONObject) { prefs.edit().putString("book", book.toString()).apply() }
    fun queue(id: String, version: Long, name: String) {
        val previous = pending(); val next = JSONArray()
        for (i in 0 until previous.length()) if (previous.getJSONObject(i).getString("id") != id) next.put(previous.getJSONObject(i))
        next.put(JSONObject().put("id", id).put("version", version).put("custom_name", name.trim().take(100)).put("request_id", UUID.randomUUID().toString()))
        prefs.edit().putString("pending", next.toString()).apply()
    }
    fun pending() = runCatching { JSONArray(prefs.getString("pending", "[]")) }.getOrDefault(JSONArray())
}

internal fun nativeContactPhone(raw: String, region: String): String? = runCatching {
    val util = PhoneNumberUtil.getInstance(); val phone = util.parse(raw, region)
    if (!util.isPossibleNumber(phone)) null else util.format(phone, PhoneNumberUtil.PhoneNumberFormat.E164)
}.getOrNull()

private fun readPhonebook(context: Context): List<JSONObject> {
    if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return emptyList()
    val region = (context.getSystemService(Context.TELEPHONY_SERVICE) as? android.telephony.TelephonyManager)?.networkCountryIso?.takeIf { it.isNotBlank() }?.uppercase(Locale.ROOT) ?: Locale.getDefault().country.takeIf { it.isNotBlank() } ?: "RU"
    val records = linkedMapOf<String, JSONObject>()
    val fields = arrayOf(ContactsContract.CommonDataKinds.Phone.LOOKUP_KEY, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
    context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, fields, null, null, null)?.use { cursor ->
        while (cursor.moveToNext()) {
            if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return emptyList()
            val phone = nativeContactPhone(cursor.getString(2).orEmpty(), region) ?: continue
            val source = MessageDigest.getInstance("SHA-256").digest((cursor.getString(0) ?: "local-${cursor.getLong(3)}").toByteArray()).joinToString("") { "%02x".format(it) }
            val record = records.getOrPut(source) { JSONObject().put("source_id", source).put("phonebook_name", cursor.getString(1).orEmpty().take(100)).put("phone_numbers", JSONArray()) }
            val phones = record.getJSONArray("phone_numbers")
            if ((0 until phones.length()).none { phones.getString(it) == phone } && phones.length() < 10) phones.put(phone)
        }
    }
    return records.values.take(5000)
}

internal object NativeContactSync {
    private val mutex = Mutex()
    suspend fun refresh(context: Context, account: Long, token: String, api: NativeApi, scan: Boolean = false) = mutex.withLock {
        withContext(Dispatchers.IO) {
            val store = NativeContactBook(context, account)
            var book = api.contactRequest("/contacts/book", token)
            val queue = store.pending()
            val retained = JSONArray()
            for (i in 0 until queue.length()) {
                val item = queue.getJSONObject(i)
                try { api.contactRequest("/contacts/${item.getString("id")}/name", token, item) }
                catch (problem: Exception) { for (j in i until queue.length()) retained.put(queue.getJSONObject(j)); store.prefs.edit().putString("pending", retained.toString()).apply(); store.save(book); throw problem }
            }
            store.prefs.edit().putString("pending", "[]").apply()
            if (queue.length() > 0) book = api.contactRequest("/contacts/book", token)
            store.save(book)
            if (!store.prefs.getBoolean("enabled", false)) return@withContext
            if (!book.optBoolean("enabled") || store.prefs.getLong("epoch", 0) != book.optLong("epoch")) {
                store.prefs.edit().putBoolean("enabled", false).remove("snapshot").apply()
                throw IllegalStateException("Синхронизация выключена или книга удалена на другом устройстве. Включите её заново")
            }
            if (!scan || context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return@withContext
            val current = readPhonebook(context)
            if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return@withContext
            val old = runCatching { JSONObject(store.prefs.getString("snapshot", "{}")!!) }.getOrDefault(JSONObject())
            val snapshot = JSONObject(); current.forEach { snapshot.put(it.getString("source_id"), it.toString()) }
            val changed = current.filter { old.optString(it.getString("source_id")) != it.toString() }
            val removed = old.keys().asSequence().filter { !snapshot.has(it) }.toList()
            var version = book.optLong("version")
            val batches = maxOf((changed.size + 39) / 40, (removed.size + 99) / 100)
            for (batch in 0 until batches) {
                if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return@withContext
                val data = JSONObject().put("device_id", store.device).put("epoch", book.optLong("epoch")).put("base_version", version)
                    .put("contacts", JSONArray(changed.drop(batch * 40).take(40))).put("removed", JSONArray(removed.drop(batch * 100).take(100)))
                version = api.contactRequest("/contacts/sync", token, data).getLong("version")
            }
            store.prefs.edit().putString("snapshot", snapshot.toString()).putLong("last_sync", System.currentTimeMillis()).apply()
            store.save(api.contactRequest("/contacts/book", token))
        }
    }
}

@Composable
internal fun NativeContactSyncHost(account: Long, token: String, api: NativeApi) {
    if (account == 0L || token.isBlank()) return
    val context = LocalContext.current; val store = remember(account) { NativeContactBook(context, account) }
    var revision by remember(account) { mutableStateOf(0) }
    val lifecycle = (context as? ComponentActivity)?.lifecycle
    DisposableEffect(account, lifecycle) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) { override fun onChange(selfChange: Boolean) { revision++ } }
        var registered = false
        fun track() {
            val allowed = store.prefs.getBoolean("enabled", false) && context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
            if (allowed && !registered) { context.contentResolver.registerContentObserver(ContactsContract.Contacts.CONTENT_URI, true, observer); registered = true }
            if (!allowed && registered) { context.contentResolver.unregisterContentObserver(observer); registered = false }
        }
        val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key == "enabled") { track(); revision++ } }
        store.prefs.registerOnSharedPreferenceChangeListener(prefsListener)
        val events = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) { track(); revision++ } }
        lifecycle?.addObserver(events); track()
        onDispose { store.prefs.unregisterOnSharedPreferenceChangeListener(prefsListener); lifecycle?.removeObserver(events); if (registered) context.contentResolver.unregisterContentObserver(observer) }
    }
    LaunchedEffect(account, token, revision) {
        delay(500)
        var scan = true
        while (true) {
            if (MainActivity.isVisible) try {
                NativeContactSync.refresh(context, account, token, api, scan)
                store.prefs.edit().remove("error").apply(); scan = false
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (problem: Exception) { store.prefs.edit().putString("error", problem.message ?: "Нет связи с контактами").apply() }
            delay(15000)
        }
    }
}

@Composable
internal fun NativeAccountContactsScreen(account: Long, token: String, api: NativeApi, onPerson: (VolnaUser) -> Unit, onProfile: (Long) -> Unit, onCall: (VolnaChat) -> Unit, onVideo: (VolnaChat) -> Unit,onRecentCalls: (() -> Unit)?=null,bottomInset: androidx.compose.ui.unit.Dp=80.dp) {
    val context = LocalContext.current; val store = remember(account) { NativeContactBook(context, account) }; val scope = rememberCoroutineScope()
    var book by remember(account) { mutableStateOf(store.cached()) }; var query by rememberSaveable(account) { mutableStateOf("") }; var sortByName by rememberSaveable(account) { mutableStateOf(true) }; var sorting by remember { mutableStateOf(false) }
    var config by remember { mutableStateOf(false) }; var manual by remember { mutableStateOf(false) }; var name by remember { mutableStateOf("") }; var number by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<JSONObject?>(null) }; var personalName by remember { mutableStateOf("") }; var purge by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }; var found by remember { mutableStateOf(emptyList<VolnaUser>()) }
    fun load(scan: Boolean = false) { if (busy) return; scope.launch { busy = true; try { NativeContactSync.refresh(context, account, token, api, scan); book = store.cached(); error = "" } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty(); book = store.cached() } finally { busy = false } } }
    fun enable() { scope.launch { busy = true; try { val settings = withContext(Dispatchers.IO) { api.contactRequest("/contacts/settings", token, JSONObject().put("enabled", true)) }; store.prefs.edit().putLong("epoch", settings.getLong("epoch")).putBoolean("enabled", true).apply(); busy = false; load(true) } catch (problem: Exception) { error = problem.message.orEmpty(); busy = false } } }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) enable() else error = "Доступ к контактам не предоставлен. Можно добавлять контакты вручную или разрешить доступ в настройках Android" }
    LaunchedEffect(account, token) { load(); while (true) { delay(15000); book = store.cached() } }
    LaunchedEffect(query) { found = emptyList(); if (query.trim().length >= 2) { delay(500); try { found = withContext(Dispatchers.IO) { api.searchPeople(token, query.trim()) } } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } } }
    val rows = book.optJSONArray("contacts") ?: JSONArray()
    val active = (0 until rows.length()).map { rows.getJSONObject(it) }.filter { !it.optBoolean("deleted") }
    val needle = query.trim().lowercase()
    val visible = active.filter { needle.isBlank() || (it.optString("display_name") + " " + it.optJSONArray("phone_numbers") + " " + it.optJSONObject("user")?.optString("username")).lowercase().contains(needle) }
    fun title(row: JSONObject) = row.optString("custom_name").ifBlank { row.optString("phonebook_name") }.ifBlank { row.optJSONObject("user")?.optString("name").orEmpty() }.ifBlank { row.optJSONArray("phone_numbers")?.optString(0).orEmpty() }
    fun call(person: VolnaUser, video: Boolean) { scope.launch { try { val id = withContext(Dispatchers.IO) { api.startChat(token, person.id) }; val chat = VolnaChat(id, person.name, person.username, "", "", 0, false, person.id); if (video) onVideo(chat) else onCall(chat) } catch (problem: Exception) { error = problem.message.orEmpty() } } }
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        NativeSearchField(query, { query = it }, "Поиск контактов", compact = true)
        TextButton(onClick={try{context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"Присоединяйся к VLN: ${BuildConfig.API_BASE_URL}/download/volna-android.apk"),"Пригласить друзей"))}catch(problem:Exception){error=problem.message.orEmpty()}},modifier=Modifier.fillMaxWidth()){Icon(Icons.Outlined.PersonAdd,null);NativeText("Пригласить друзей",Modifier.weight(1f).padding(start=12.dp))}
        if(onRecentCalls!=null)TextButton(onClick=onRecentCalls,modifier=Modifier.fillMaxWidth()){Icon(Icons.Outlined.History,null);NativeText("Недавние звонки",Modifier.weight(1f).padding(start=12.dp))}
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                TextButton(onClick = { sorting = true }) { NativeText(if (sortByName) "Сортировка по имени" else "Сортировка по времени захода", color = Accent, fontSize = 12.sp) }
                DropdownMenu(sorting, { sorting = false }) {
                    DropdownMenuItem(text = { NativeText("По имени") }, onClick = { sortByName = true; sorting = false })
                    DropdownMenuItem(text = { NativeText("По времени захода") }, onClick = { sortByName = false; sorting = false })
                }
            }
            IconButton(onClick = { config = true }) { Icon(Icons.Outlined.Sync, "Контакты и синхронизация", tint = Muted) }
        }
        if (error.isNotBlank()) NativeConnectionNotice(error) { load(true) }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = bottomInset+20.dp)) {
            for ((registered, label) in listOf(true to "Пользователи VLN", false to "Пригласить в VLN")) {
            val section = visible.filter { (it.optJSONObject("user") != null) == registered }.sortedWith(
                if (sortByName) compareBy { title(it).lowercase(Locale.ROOT) }
                else compareByDescending<JSONObject> { it.optJSONObject("user")?.optBoolean("online") == true }.thenByDescending { it.optJSONObject("user")?.optLong("last_seen") ?: 0L }.thenBy { title(it).lowercase(Locale.ROOT) })
            if (section.isNotEmpty()) item { NativeText(label, Modifier.padding(12.dp), color = Muted) }
            items(section, key = { it.getString("contact_id") }) { row ->
                val person = row.optJSONObject("user")?.let(api::contactUser)
                var actions by remember(row.getString("contact_id")) { mutableStateOf(false) }
                Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).clickable { if (person != null) onPerson(person) else actions = true }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.clickable { if (person != null) onProfile(person.id) }) { Avatar(title(row), person?.id ?: row.getString("contact_id").hashCode().toLong(), person?.avatarUrl, token, size = 42.dp) }
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        NativeText(title(row), color = TextMain, fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        NativeText(if (person == null) "Пригласить в VLN" else if (person.online) "в сети" else if (person.lastSeen > 0) "был(а) " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(person.lastSeen)) else "Статус недоступен", color = if (person?.online == true) Accent else Muted, fontSize = 12.sp, lineHeight = 16.sp)
                    }
                    Box {
                        IconButton(onClick = { actions = true }) { Icon(Icons.Outlined.MoreVert, "Действия контакта ${title(row)}", tint = Muted, modifier = Modifier.size(20.dp)) }
                        DropdownMenu(actions, { actions = false }) {
                            if (person != null) {
                                DropdownMenuItem(text = { NativeText("Написать") }, onClick = { actions = false; onPerson(person) })
                                DropdownMenuItem(text = { NativeText("Профиль") }, onClick = { actions = false; onProfile(person.id) })
                                DropdownMenuItem(text = { NativeText("Позвонить") }, onClick = { actions = false; call(person, false) })
                                DropdownMenuItem(text = { NativeText("Видеозвонок") }, onClick = { actions = false; call(person, true) })
                            } else DropdownMenuItem(text = { NativeText("Пригласить") }, onClick = { actions = false; context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Присоединяйся к VLN: ${BuildConfig.API_BASE_URL}/download/volna-android.apk"), "Пригласить в VLN")) })
                            DropdownMenuItem(text = { NativeText("Изменить имя") }, onClick = { actions = false; editing = row; personalName = row.optString("custom_name") })
                        }
                    }
                }
            }
            }
            items(found.filter { person -> active.none { it.optLong("linked_user_id") == person.id } }, key = { "found-${it.id}" }) { person -> NativeSettingRow(Icons.Outlined.Person, person.name, "@${person.username}") { onProfile(person.id) } }
            if (visible.isEmpty() && found.isEmpty()) item { NativeEmptyState(Icons.Outlined.Contacts, "Контактов пока нет", "Включите синхронизацию или добавьте номер вручную") }
        }
    }
    FloatingActionButton(onClick={name="";number="";manual=true},shape=androidx.compose.foundation.shape.CircleShape,containerColor=Accent,contentColor=AccentText,modifier=Modifier.align(androidx.compose.ui.Alignment.BottomEnd).padding(end=16.dp,bottom=bottomInset+16.dp)){Icon(Icons.Outlined.PersonAdd,"Добавить контакт")}
    }
    if (config) ModalBottomSheet(onDismissRequest = { config = false }, containerColor = Panel) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        NativeText("Контакты и синхронизация", Modifier.padding(16.dp), fontSize = 20.sp)
        NativeText("Разрешите доступ к контактам, чтобы находить знакомых в VLN и синхронизировать телефонную книгу между вашими устройствами. На сервер передаются имена и номера; свои названия видите только вы.", Modifier.padding(horizontal = 16.dp), fontSize = 13.sp, color = Muted)
        Row(Modifier.padding(16.dp)) { NativeText("Синхронизировать контакты", Modifier.weight(1f)); Switch(store.prefs.getBoolean("enabled", false), { enabled -> if (enabled) { if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) enable() else permission.launch(Manifest.permission.READ_CONTACTS) } else scope.launch { try { withContext(Dispatchers.IO) { api.contactRequest("/contacts/settings", token, JSONObject().put("enabled", false)) }; store.prefs.edit().putBoolean("enabled", false).apply(); load() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) }
        if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { NativeText("Настройки доступа Android") }
        TextButton(onClick = { load(true) }, enabled = !busy) { NativeText("Синхронизировать сейчас / найти контакты в VLN") }
        NativeText("Последняя синхронизация: ${store.prefs.getLong("last_sync", 0).takeIf { it > 0 }?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "ещё не выполнена"}", Modifier.padding(horizontal = 16.dp), fontSize = 12.sp, color = Muted)
        NativeText("Кто может найти меня по номеру", Modifier.padding(16.dp))
        listOf("everyone" to "Все пользователи", "contacts" to "Мои контакты", "nobody" to "Никто").forEach { (key, label) -> TextButton(onClick = { scope.launch { try { withContext(Dispatchers.IO) { api.contactRequest("/contacts/settings", token, JSONObject().put("discovery", key)) }; load() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { NativeText((if (book.optString("discovery") == key) "✓ " else "") + label) } }
        NativeText("Кто видит меня в сети", Modifier.padding(16.dp))
        listOf("everyone" to "Все пользователи", "contacts" to "Мои контакты", "nobody" to "Никто").forEach { (key, label) -> TextButton(onClick = { scope.launch { try { withContext(Dispatchers.IO) { api.contactRequest("/contacts/settings", token, JSONObject().put("presence", key)) }; load() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { NativeText((if (book.optString("presence") == key) "✓ " else "") + label) } }
        if (error.isNotBlank()) NativeText(error, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { purge = true }) { NativeText("Удалить импортированные контакты", color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(20.dp))
        }
    }
    if (manual) AlertDialog(onDismissRequest = { manual = false }, title = { NativeText("Добавить контакт") }, text = { Column { NativeOutlinedTextField(name, { name = it }, label = { NativeText("Имя") }); NativeOutlinedTextField(number, { number = it }, label = { NativeText("Номер с кодом страны") }); if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error) } }, confirmButton = { TextButton(onClick = { scope.launch { try { val phone = nativeContactPhone(number, "RU") ?: error("Проверьте номер телефона"); withContext(Dispatchers.IO) { api.contactRequest("/contacts/manual", token, JSONObject().put("phonebook_name", name).put("phone_numbers", JSONArray().put(phone))) }; manual = false; load() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { NativeText("Добавить") } }, dismissButton = { TextButton(onClick = { manual = false }) { NativeText("Отмена") } })
    editing?.let { row -> AlertDialog(onDismissRequest = { editing = null }, title = { NativeText("Изменить имя") }, text = { Column { NativeOutlinedTextField(personalName, { personalName = it }, label = { NativeText("Только для вас") }); TextButton(onClick = { personalName = "" }) { NativeText("Вернуть исходное имя") } } }, confirmButton = { TextButton(onClick = { store.queue(row.getString("contact_id"), row.getLong("version"), personalName); editing = null; load() }) { NativeText("Сохранить") } }, dismissButton = { TextButton(onClick = { editing = null }) { NativeText("Отмена") } }) }
    if (purge) AlertDialog(onDismissRequest = { purge = false }, title = { NativeText("Удалить импортированные контакты?") }, text = { NativeText("Телефонная книга будет удалена с сервера и устройств VLN. Чаты и личные имена сохранятся. Автоматическая синхронизация выключится.") }, confirmButton = { TextButton(onClick = { scope.launch { try { withContext(Dispatchers.IO) { api.contactRequest("/contacts/purge", token, JSONObject().put("confirm", true)) }; store.prefs.edit().putBoolean("enabled", false).remove("snapshot").apply(); purge = false; load() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { NativeText("Удалить") } }, dismissButton = { TextButton(onClick = { purge = false }) { NativeText("Отмена") } })
}

@Composable
internal fun rememberNativeContactNames(account: Long): Map<Long, String> {
    val context = LocalContext.current
    val store = remember(account) { NativeContactBook(context, account) }
    var revision by remember(account) { mutableStateOf(0) }
    DisposableEffect(store) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key == "book" || key == "pending") revision++ }
        store.prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { store.prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return remember(account, revision) {
        val rows = store.cached().optJSONArray("contacts") ?: JSONArray()
        buildMap { for (i in 0 until rows.length()) { val row = rows.getJSONObject(i); val id = row.optLong("linked_user_id"); val name = row.optString("custom_name").ifBlank { row.optString("phonebook_name") }.ifBlank { row.optJSONObject("user")?.optString("profile_name").orEmpty().ifBlank { row.optJSONObject("user")?.optString("name").orEmpty() } }; if (!row.optBoolean("deleted") && id > 0 && name.isNotBlank()) put(id, name) } }
    }
}

@Composable
internal fun NativePrivateContactName(account: Long, userId: Long, token: String, api: NativeApi, onSaved: () -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val store = remember(account) { NativeContactBook(context, account) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }; var name by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }
    TextButton(onClick = { scope.launch { try {
        val rows = store.cached().optJSONArray("contacts") ?: JSONArray()
        var row: JSONObject? = (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.optLong("linked_user_id") == userId && !it.optBoolean("deleted") }
        if (row == null) row = withContext(Dispatchers.IO) { api.contactRequest("/contacts/link", token, JSONObject().put("user_id", userId)) }
        editing = row; name = row!!.optString("custom_name"); error = ""
    } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { Icon(Icons.Outlined.Edit, null); NativeText("Изменить имя контакта") }
    if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
    editing?.let { row -> AlertDialog(onDismissRequest = { editing = null }, title = { NativeText("Изменить имя") }, text = { Column { NativeText("Это имя видно только вам на всех ваших устройствах"); NativeOutlinedTextField(name, { name = it.take(100) }); TextButton(onClick = { name = "" }) { NativeText("Вернуть исходное имя") } } }, confirmButton = { TextButton(onClick = { store.queue(row.getString("contact_id"), row.getLong("version"), name); editing = null; scope.launch { try { NativeContactSync.refresh(context, account, token, api); onSaved() } catch (problem: Exception) { error = problem.message.orEmpty() } } }) { NativeText("Сохранить") } }, dismissButton = { TextButton(onClick = { editing = null }) { NativeText("Отмена") } }) }
}

internal fun nativeContactCallerName(context:Context,account:Long,peer:VolnaUser?):String {
 val contacts=NativeContactBook(context,account).cached().optJSONArray("contacts")?:JSONArray()
 for(i in 0 until contacts.length()){
  val row=contacts.getJSONObject(i)
  if(!row.optBoolean("deleted")&&row.optLong("linked_user_id")==peer?.id)return nativeCallerName(row.optString("custom_name"),row.optString("phonebook_name"),peer?.name.orEmpty())
 }
 return nativeCallerName("","",peer?.name.orEmpty())
}

internal fun nativeContactCallerPhone(context:Context,account:Long,peer:VolnaUser?):String?{
 val contacts=NativeContactBook(context,account).cached().optJSONArray("contacts")?:JSONArray()
 for(i in 0 until contacts.length()){
  val row=contacts.getJSONObject(i)
  if(row.optBoolean("deleted")||row.optLong("linked_user_id")!=peer?.id)continue
  val phones=row.optJSONArray("phone_numbers")?:continue
  for(j in 0 until phones.length())nativeKnownContactPhone(phones.optString(j))?.let{return it}
 }
 return peer?.phone?.let{nativeKnownContactPhone(it)}
}
