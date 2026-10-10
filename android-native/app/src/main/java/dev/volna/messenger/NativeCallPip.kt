package dev.volna.messenger

import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

internal fun nativePipEligible(state: NativeCallState) = state.call != null && state.connected && (state.call.video || state.cameraEnabled || state.remoteVideo || state.remoteSharing || NativeCallLayout.forCall(state.call.id).video)
internal fun ComponentActivity.configureCallPip() {
    if (Build.VERSION.SDK_INT < 26 || !packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return
    lifecycleScope.launch { NativeCalls.state.collect { state ->
        val eligible = nativePipEligible(state)
        runCatching { setPictureInPictureParams(PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16)).apply { if (Build.VERSION.SDK_INT >= 31) setAutoEnterEnabled(eligible) }.build()) }
        if (!eligible && isInPictureInPictureMode) { finish(); NativeCallLayout.inPip = false }
    } }
}
internal fun ComponentActivity.enterCallPip() {
    if (Build.VERSION.SDK_INT >= 26 && nativePipEligible(NativeCalls.state.value) && packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
        runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16)).build()) }
    }
}
