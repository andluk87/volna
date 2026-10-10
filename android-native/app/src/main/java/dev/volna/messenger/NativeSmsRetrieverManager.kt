package dev.volna.messenger

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

internal interface NativeSmsMonitor {
    val appHash: String
    suspend fun start(retriever: Boolean, onMessage: (String) -> Unit, onConsent: (Intent) -> Unit, onTimeout: () -> Unit): Boolean
    fun stop()
}

internal class NativeSmsRetrieverManager(private val context: Context) : NativeSmsMonitor {
    private var receiver: BroadcastReceiver? = null
    override val appHash: String = runCatching {
        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners.orEmpty()
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures.orEmpty()
        }
        NativeSmsCodeParser.appHash(context.packageName, signatures.first().toCharsString())
    }.getOrDefault("")

    override suspend fun start(retriever: Boolean, onMessage: (String) -> Unit, onConsent: (Intent) -> Unit, onTimeout: () -> Unit): Boolean {
        stop()
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) return false
        val current = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (receiver !== this || intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
                @Suppress("DEPRECATION")
                val status = intent.extras?.getParcelable<Status>(SmsRetriever.EXTRA_STATUS) ?: return
                when (status.statusCode) {
                    CommonStatusCodes.SUCCESS -> {
                        if (retriever) intent.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE)?.let(onMessage)
                        else {
                            @Suppress("DEPRECATION")
                            intent.extras?.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT)?.let(onConsent)
                        }
                    }
                    CommonStatusCodes.TIMEOUT -> { stop(); onTimeout() }
                }
            }
        }
        receiver = current
        return try {
            ContextCompat.registerReceiver(context, current, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION), SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED)
            val client = SmsRetriever.getClient(context)
            val started = withTimeoutOrNull(5000) {
                suspendCancellableCoroutine<Boolean> { continuation ->
                    val task = if (retriever) client.startSmsRetriever() else client.startSmsUserConsent(null)
                    task.addOnSuccessListener { if (continuation.isActive) continuation.resume(true) }
                        .addOnFailureListener { if (continuation.isActive) continuation.resume(false) }
                }
            } ?: false
            if (!started) stop()
            started
        } catch (cancelled: kotlinx.coroutines.CancellationException) { stop(); throw cancelled }
        catch (_: Exception) { stop(); false }
    }
    override fun stop() { receiver?.let { runCatching { context.unregisterReceiver(it) } }; receiver = null }
}
