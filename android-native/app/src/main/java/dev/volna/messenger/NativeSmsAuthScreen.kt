package dev.volna.messenger

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.util.Locale
import java.util.UUID

private data class SmsCountry(val region: String, val name: String, val prefix: String)
private val smsCountries by lazy {
    val util = PhoneNumberUtil.getInstance()
    util.supportedRegions.map { region -> SmsCountry(region, Locale("", region).getDisplayCountry(Locale("ru")), "+${util.getCountryCodeForRegion(region)}") }.sortedBy { it.name }
}

private class SmsPhoneTransformation(private val country: String) : VisualTransformation {
    override fun filter(text: androidx.compose.ui.text.AnnotatedString): TransformedText {
        val input = text.text
        val region = PhoneNumberUtil.getInstance().getRegionCodeForCountryCode(country.removePrefix("+").toIntOrNull() ?: 7) ?: "RU"
        val formatter = PhoneNumberUtil.getInstance().getAsYouTypeFormatter(region)
        var formatted = ""
        input.forEach { formatted = formatter.inputDigit(it) }
        val positions = mutableListOf(0); var cursor = 0
        input.forEach { digit -> while (cursor < formatted.length && formatted[cursor] != digit) cursor++; cursor = (cursor + 1).coerceAtMost(formatted.length); positions.add(cursor) }
        return TransformedText(androidx.compose.ui.text.AnnotatedString(formatted), object : OffsetMapping {
            override fun originalToTransformed(offset: Int) = positions[offset.coerceIn(0, input.length)]
            override fun transformedToOriginal(offset: Int) = positions.count { it <= offset.coerceIn(0, formatted.length) }.minus(1).coerceIn(0, input.length)
        })
    }
}

@Composable
internal fun NativeSmsLogin(api: NativeApi, update: VolnaUpdate?, updateBusy: Boolean, updateStatus: String,
    onUpdate: () -> Unit, onSignedIn: (VolnaSession) -> Unit) {
    val context = LocalContext.current
    val loginKey = rememberSaveable { UUID.randomUUID().toString() }
    val model: NativeSmsAuthViewModel = viewModel(key = "sms-$loginKey", factory = viewModelFactory {
        initializer { NativeSmsAuthViewModel(context.applicationContext, api, createSavedStateHandle()) }
    })
    val state by model.state.collectAsState()
    val keyboard = LocalSoftwareKeyboardController.current
    var countryRegion by rememberSaveable { mutableStateOf("RU") }
    var countryPicker by remember { mutableStateOf(false) }
    var countrySearch by remember { mutableStateOf("") }
    var consentGeneration by remember { mutableIntStateOf(0) }
    val consent = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        model.consentResult(if (result.resultCode == android.app.Activity.RESULT_OK) result.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE) else null, consentGeneration)
    }
    LaunchedEffect(state.consentIntent) {
        state.consentIntent?.let { intent -> consentGeneration = state.generation; model.consumeConsent(); runCatching { consent.launch(intent) } }
    }
    LaunchedEffect(state.session) { state.session?.let { keyboard?.hide(); onSignedIn(it) } }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) model.resume() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val otpDescription = stringResource(R.string.sms_auth_otp_accessibility)
    val codeScreen = state.challenge.isNotBlank()
    BackHandler(enabled = codeScreen || state.busy) { model.back() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(codeScreen) { if (codeScreen) { focus.requestFocus(); keyboard?.show() } }
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.ime).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (codeScreen || state.busy) IconButton(onClick = { model.back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.sms_auth_change_number)) }
        }
        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Box(Modifier.size(100.dp).background(Accent.copy(alpha = .12f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(if (codeScreen) Icons.Outlined.MarkEmailRead else Icons.Outlined.PhoneAndroid, null, Modifier.size(52.dp), tint = Accent)
            }
            Spacer(Modifier.height(4.dp))
            NativeText(if (codeScreen) stringResource(R.string.sms_auth_code_title) else stringResource(R.string.sms_auth_phone_title), fontSize = 25.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            NativeText(if (codeScreen) stringResource(R.string.sms_auth_sent_description, state.maskedPhone) else stringResource(R.string.sms_auth_phone_description), color = Muted, textAlign = TextAlign.Center, lineHeight = 22.sp)
            Spacer(Modifier.height(2.dp))
            if (!codeScreen) {
                OutlinedButton(onClick = { countrySearch = ""; countryPicker = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(12.dp)) {
                    NativeText((smsCountries.firstOrNull { it.region == countryRegion && it.prefix == state.country } ?: smsCountries.firstOrNull { it.prefix == state.country })?.name ?: stringResource(R.string.sms_auth_country), Modifier.weight(1f), textAlign = TextAlign.Start)
                    Icon(Icons.Outlined.ExpandMore, stringResource(R.string.sms_auth_select_country))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(state.country, { model.editCountry("+" + it.filter { c -> c in '0'..'9' }.take(3)) }, Modifier.width(90.dp), label = { NativeText(stringResource(R.string.sms_auth_dial_code)) }, singleLine = true, enabled = !state.busy, shape = RoundedCornerShape(12.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                    OutlinedTextField(state.phone, { model.editPhone(it.filter { c -> c in "+0123456789" }) }, Modifier.weight(1f), label = { NativeText(stringResource(R.string.sms_auth_phone_number)) }, singleLine = true, enabled = !state.busy, shape = RoundedCornerShape(12.dp), visualTransformation = remember(state.country) { SmsPhoneTransformation(state.country) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { model.send() }))
                }
                Button(onClick = { model.send() }, enabled = !state.busy && state.phone.isNotBlank() && state.resendSeconds == 0L, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(12.dp)) {
                    if (state.busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else NativeText(if (state.resendSeconds > 0) stringResource(R.string.sms_auth_retry_seconds, state.resendSeconds) else stringResource(R.string.sms_auth_continue), fontSize = 16.sp, fontWeight = FontWeight.Medium)
                }
            } else {
                BasicTextField(value = state.code, onValueChange = model::editCode, enabled = !state.busy && state.expiresSeconds > 0,
                    modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = otpDescription }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                    textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 26.sp), cursorBrush = SolidColor(Accent),
                    decorationBox = { inner ->
                        // Keep the real editor in the tree for clipboard, keyboard,
                        // autofill and accessibility; six boxes are its visual decoration.
                        Box {
                            Box(Modifier.size(1.dp)) { inner() }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                repeat(6) { index ->
                                    val selected = index == state.code.length.coerceAtMost(5)
                                    Box(Modifier.weight(1f).height(58.dp).border(if (selected) 2.dp else 1.dp, if (state.error.isNotEmpty()) MaterialTheme.colorScheme.error else if (selected) Accent else MaterialTheme.colorScheme.outline.copy(alpha = .45f), RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                        NativeText(state.code.getOrNull(index)?.toString() ?: "", fontSize = 26.sp, fontWeight = FontWeight.Medium)
                                    }
                                }
                            }
                        }
                    })
                if (state.busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                NativeText(when {
                    state.phase == NativeAuthPhase.VERIFYING_CODE -> stringResource(R.string.sms_auth_verifying)
                    state.phase == NativeAuthPhase.SMS_RECEIVED -> stringResource(R.string.sms_auth_received)
                    state.expiresSeconds == 0L -> stringResource(R.string.sms_auth_request_new)
                    state.listening -> stringResource(R.string.sms_auth_waiting)
                    else -> stringResource(R.string.sms_auth_manual)
                }, color = Muted, textAlign = TextAlign.Center)
                if (state.consent) NativeText(stringResource(R.string.sms_auth_consent_description), fontSize = 13.sp, color = Muted, textAlign = TextAlign.Center)
                if (state.retryVerification) OutlinedButton(onClick = model::retryVerification, enabled = !state.busy && state.expiresSeconds > 0) { NativeText(stringResource(R.string.sms_auth_retry_verify)) }
                TextButton(onClick = model::send, enabled = !state.busy && state.resendSeconds == 0L) {
                    NativeText(if (state.resendSeconds > 0) stringResource(R.string.sms_auth_resend_seconds, state.resendSeconds) else stringResource(R.string.sms_auth_resend))
                }
                TextButton(onClick = model::back, enabled = !state.busy) { NativeText(stringResource(R.string.sms_auth_change_number)) }
            }
            if (state.error.isNotBlank()) NativeText(state.error, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            if (!codeScreen) NativeText(stringResource(R.string.sms_auth_privacy), color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
            if (update != null) UpdateBanner(update, updateBusy, updateStatus, onUpdate)
            Spacer(Modifier.height(28.dp))
        }
    }
    if (countryPicker) AlertDialog(onDismissRequest = { countryPicker = false }, title = { NativeText(stringResource(R.string.sms_auth_choose_country)) }, text = {
        Column {
            OutlinedTextField(countrySearch, { countrySearch = it }, Modifier.fillMaxWidth(), placeholder = { NativeText(stringResource(R.string.sms_auth_country_search)) }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) })
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(smsCountries.filter { it.name.contains(countrySearch, true) || it.prefix.contains(countrySearch) || it.region.equals(countrySearch, true) }, key = { it.region }) { country ->
                    Row(Modifier.fillMaxWidth().clickable { countryRegion = country.region; model.editCountry(country.prefix); countryPicker = false }.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        NativeText(country.name, Modifier.weight(1f)); NativeText(country.prefix, color = Accent)
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { countryPicker = false }) { NativeText(stringResource(R.string.sms_auth_close)) } })
}
