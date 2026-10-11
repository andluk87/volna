package dev.volna.messenger

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext

/** Keeps standalone and PiP call windows synchronized with the account appearance. */
@Composable
internal fun rememberNativeCallAppearance(account: Long): NativeAppearance {
    val context = LocalContext.current
    val prefs = remember(context, account) { listOf(context.getSharedPreferences("volna-appearance-$account", Context.MODE_PRIVATE), context.getSharedPreferences("volna-appearance", Context.MODE_PRIVATE)) }
    fun load() = NativeAppearance.load(prefs.firstOrNull { it.all.isNotEmpty() } ?: prefs.last())
    var appearance by remember(prefs) { mutableStateOf(load()) }
    DisposableEffect(prefs) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> appearance = load() }
        prefs.forEach { it.registerOnSharedPreferenceChangeListener(listener) }
        onDispose { prefs.forEach { it.unregisterOnSharedPreferenceChangeListener(listener) } }
    }
    return appearance
}
