package dev.volna.messenger

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun NativeSmsLogin(api: NativeApi, update: VolnaUpdate?, updateBusy: Boolean, updateStatus: String,
    onUpdate: () -> Unit, onSignedIn: (VolnaSession) -> Unit) {
    var country by remember { mutableStateOf("+7") }; var phone by remember { mutableStateOf("") }
    var requestedPhone by remember { mutableStateOf("") }
    var challenge by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    var resendAt by remember { mutableStateOf(0L) }; var expiresAt by remember { mutableStateOf(0L) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }; var countries by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(challenge) { while (challenge.isNotBlank()) { now = System.currentTimeMillis(); delay(1000) } }
    fun send() {
        if (busy) return
        scope.launch {
            busy = true; error = ""
            try {
                val number = nativeSmsPhone(country, phone)
                val value = withContext(Dispatchers.IO) { api.smsRequest(number) }
                requestedPhone = number
                challenge = value.getString("sms_session_id"); code = ""
                now = System.currentTimeMillis(); resendAt = now + value.getLong("resend_after") * 1000; expiresAt = now + value.getLong("expires_in") * 1000
            } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось получить SMS" }
            finally { busy = false }
        }
    }
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.ime).verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(24.dp)); NativeText("Волна", fontSize = 32.sp, color = Accent)
        NativeText(if (challenge.isBlank()) "Вход по номеру телефона" else "Код из SMS", fontSize = 22.sp)
        if (challenge.isBlank()) {
            NativeText("Первый вход и регистрация — в Android. Web и Windows подключаются по QR с этого телефона.", color = Muted)
            Box { TextButton(onClick = { countries = true }, enabled = !busy) { NativeText("Код страны: $country") }
                DropdownMenu(countries, { countries = false }) {
                    listOf("+7" to "Россия / Казахстан", "+375" to "Беларусь", "+380" to "Украина", "+998" to "Узбекистан", "+374" to "Армения", "+995" to "Грузия", "+49" to "Германия", "+1" to "США / Канада").forEach { (prefix,label) -> DropdownMenuItem(text = { NativeText("$prefix · $label") }, onClick = { country = prefix; countries = false }) }
                }
            }
            NativeOutlinedTextField(country, { input -> country = "+" + input.filter { it.isDigit() }.take(3) }, label = { NativeText("Код страны") }, singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            NativeOutlinedTextField(phone, { phone = it.filter { c -> c in "+0123456789 ()-" }.take(40) }, Modifier.fillMaxWidth(), label = { NativeText("Номер телефона") }, singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            Button(onClick = ::send, enabled = !busy && phone.length >= 6 && country.length > 1, modifier = Modifier.fillMaxWidth()) { NativeText(if (busy) "Отправляем…" else "Получить код") }
        } else {
            NativeText("Код запрошен для $requestedPhone. Доставка SMS может занять некоторое время.", color = Muted)
            NativeOutlinedTextField(code, { code = it.filter { c -> c.isDigit() || c == '-' }.take(7) }, Modifier.fillMaxWidth(), label = { NativeText("123-456") }, singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            Button(enabled = !busy && code.filter { it.isDigit() }.length == 6 && now < expiresAt, modifier = Modifier.fillMaxWidth(), onClick = { scope.launch {
                busy = true; error = ""
                try { val session = withContext(Dispatchers.IO) { api.smsVerify(challenge, code) }; NativeCredentials.store(session); onSignedIn(session) }
                catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось войти" }
                finally { busy = false }
            } }) { NativeText(if (busy) "Проверяем…" else "Войти") }
            if (now >= expiresAt) NativeText("Код истёк. Запросите новый.", color = Muted)
            TextButton(onClick = ::send, enabled = !busy && now >= resendAt) { NativeText(if (now >= resendAt) "Отправить код повторно" else "Повтор через ${(resendAt-now+999)/1000} с") }
            TextButton(onClick = { if (!busy) { challenge = ""; code = ""; error = "" } }) { NativeText("Изменить номер") }
        }
        if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
        if (update != null) UpdateBanner(update, updateBusy, updateStatus, onUpdate)
    }
}

@Composable
@androidx.annotation.OptIn(markerClass = [androidx.camera.core.ExperimentalGetImage::class])
internal fun NativeQrScanner(token: String, api: NativeApi, initialQr: String = "", onDismiss: () -> Unit) {
    val context = LocalContext.current; val owner = context as? LifecycleOwner; val scope = rememberCoroutineScope()
    var permitted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permitted = it }
    var preview by remember { mutableStateOf<PreviewView?>(null) }
    var qr by remember { mutableStateOf(initialQr) }; var info by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    val frozen = remember { AtomicBoolean(initialQr.isNotBlank()) }
    LaunchedEffect(qr) {
        if (qr.isBlank()) return@LaunchedEffect
        if (!qr.matches(Regex("volna://login/[A-Za-z0-9_-]{43}"))) { error = "Это не QR-код входа Волны"; return@LaunchedEffect }
        busy = true; error = ""; info = null
        try { info = withContext(Dispatchers.IO) { api.qrScan(token, qr) } }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "QR-код недоступен" }
        finally { busy = false }
    }
    DisposableEffect(preview, permitted) {
        val view = preview; val executor = Executors.newSingleThreadExecutor(); val disposed = AtomicBoolean(false)
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
        var provider: ProcessCameraProvider? = null; var analysis: ImageAnalysis? = null; var cameraPreview: Preview? = null
        if (permitted && view != null && owner != null) {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                if (!disposed.get()) try {
                    val cameras = future.get(); provider = cameras
                    val display = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }; cameraPreview = display
                    val frames = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build(); analysis = frames
                    frames.setAnalyzer(executor) { proxy ->
                        val image = proxy.image
                        if (image == null || frozen.get() || disposed.get()) proxy.close()
                        else scanner.process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees))
                            .addOnSuccessListener { values -> values.firstOrNull { it.rawValue?.startsWith("volna://login/") == true }?.rawValue?.let { value -> if (frozen.compareAndSet(false, true) && !disposed.get()) qr = value } }
                            .addOnCompleteListener { proxy.close() }
                    }
                    cameras.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, display, frames)
                } catch (problem: Exception) { error = "Не удалось включить камеру: ${problem.message.orEmpty().take(100)}" }
            }, ContextCompat.getMainExecutor(context))
        }
        onDispose { disposed.set(true); analysis?.clearAnalyzer(); cameraPreview?.let { p -> analysis?.let { a -> provider?.unbind(p,a) } }; scanner.close(); executor.shutdown() }
    }
    NativeFullScreen("Сканировать QR", onDismiss) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            NativeText("Отсканируйте QR в открытой Web или Windows-версии Волны. Подтвердите только вход на своём устройстве.", color = Muted)
            if (!permitted) Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) { NativeText("Разрешить камеру") }
            else AndroidView(factory = { PreviewView(it).also { view -> preview = view } }, modifier = Modifier.fillMaxWidth().weight(1f))
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error.isNotBlank()) NativeText(error, color = MaterialTheme.colorScheme.error)
            info?.let { details ->
                NativeText("Разрешить вход в ${if(details.optString("platform") == "windows") "Windows" else "Web"}?", fontSize = 20.sp)
                NativeText(details.optString("device"), color = Muted, fontSize = 12.sp)
                NativeText("Адрес подключения: ${details.optString("ip")}", color = Muted, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(enabled = !busy, onClick = { scope.launch { busy = true; try { withContext(Dispatchers.IO) { api.qrConfirm(token, qr, true) }; onDismiss() } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Вход не подтверждён" } finally { busy = false } } }) { NativeText("Подтвердить вход") }
                    OutlinedButton(enabled = !busy, onClick = { scope.launch { try { withContext(Dispatchers.IO) { api.qrConfirm(token, qr, false) }; onDismiss() } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message ?: "Не удалось отклонить" } } }) { NativeText("Отклонить") }
                }
            }
            TextButton(enabled = !busy, onClick = { qr = ""; info = null; error = ""; frozen.set(false) }) { NativeText("Сканировать другой код") }
        }
    }
}

@Composable
internal fun NativeProfileEditor(userId: Long, currentUser: VolnaUser?, token: String, api: NativeApi, onDismiss: () -> Unit, onSaved: (VolnaUser) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var profile by remember(userId) { mutableStateOf<VolnaUser?>(null) }; var name by remember { mutableStateOf("") }; var bio by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf("") }
    val own = userId == currentUser?.id
    LaunchedEffect(userId) { try { profile = withContext(Dispatchers.IO) { api.userProfile(token,userId) }; name = profile!!.name; bio = profile!!.bio } catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error = problem.message.orEmpty() } }
    val photo = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null && own) scope.launch {
        busy = true
        try { val updated = withContext(Dispatchers.IO) { val mime = context.contentResolver.getType(uri).orEmpty(); require(mime in listOf("image/png","image/jpeg","image/webp")) { "Фото: PNG, JPEG или WebP" }; val bytes = readAttachment(context.contentResolver,uri); require(bytes.size <= 5*1024*1024) { "Фото больше 5 МБ" }; val id = api.upload(token,"avatar",mime,bytes); api.updateProfile(token,name,bio,true,id) }; profile=updated; onSaved(updated) }
        catch (cancelled: CancellationException) { throw cancelled } catch (problem: Exception) { error=problem.message.orEmpty() } finally { busy=false }
    } }
    NativeFullScreen(if (own) "Мой профиль" else "Профиль", onDismiss) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            profile?.let { user ->
                Avatar(user.name,user.id,user.avatarUrl,token,size=88.dp)
                if (own) {
                    NativeText("Номер: ${user.phone} · подтверждён", color=Muted)
                    NativeUsernameEditor(user,token,api) { updated -> profile=updated;onSaved(updated) }
                    NativeOutlinedTextField(name,{name=it.take(64)},Modifier.fillMaxWidth(),label={NativeText("Имя")},enabled=!busy)
                    NativeOutlinedTextField(bio,{bio=it.take(280)},Modifier.fillMaxWidth(),label={NativeText("О себе")},enabled=!busy)
                    TextButton(enabled=!busy,onClick={photo.launch(arrayOf("image/png","image/jpeg","image/webp"))}) { NativeText("Выбрать фото") }
                    if(user.avatarUrl!=null) TextButton(enabled=!busy,onClick={scope.launch { busy=true; try { val updated=withContext(Dispatchers.IO){api.updateProfile(token,name,bio,true,null,true)};profile=updated;onSaved(updated) } catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}finally{busy=false} }}){NativeText("Убрать фото")}
                    Button(enabled=!busy&&name.isNotBlank(),onClick={scope.launch {busy=true;try{val updated=withContext(Dispatchers.IO){api.updateProfile(token,name,bio)};profile=updated;onSaved(updated);onDismiss()}catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){error=problem.message.orEmpty()}finally{busy=false}}}){NativeText("Сохранить")}
                    NativeText("Телефон доступен для точного поиска. Публичный ник можно изменить; другие устройства подключаются по QR.",color=Muted,fontSize=13.sp)
                }else { NativeText(user.name,fontSize=22.sp);NativeText(user.bio,color=Muted) }
            }
            if(error.isNotBlank())NativeText(error,color=MaterialTheme.colorScheme.error)
        }
    }
}
