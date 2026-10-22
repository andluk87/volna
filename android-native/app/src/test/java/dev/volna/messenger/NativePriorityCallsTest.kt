package dev.volna.messenger

import android.app.Application
import android.app.NotificationManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativePriorityCallsTest {
    @Test fun exceptionsBelongToOneContactAndAccount() {
        val context = RuntimeEnvironment.getApplication()
        NativeNotificationPolicy.prefs(context, 1).edit().clear().putBoolean("priority_call_9", true).commit()
        NativeNotificationPolicy.prefs(context, 2).edit().clear().commit()
        assertTrue(NativePriorityCalls.enabled(context, 1, 9))
        assertFalse(NativePriorityCalls.enabled(context, 1, 10))
        assertFalse(NativePriorityCalls.enabled(context, 2, 9))
        assertFalse(NativePriorityCalls.enabled(context, 0, 9))
        assertFalse(NativePriorityCalls.enabled(context, 1, 0))
        NativeNotificationPolicy.prefs(context, 1).edit().putBoolean("priority_call_9", false).commit()
        assertFalse(NativePriorityCalls.enabled(context, 1, 9))
    }

    @Test fun priorityDoesNotOverrideDoNotDisturb() {
        val context = RuntimeEnvironment.getApplication()
        NativeNotificationPolicy.prefs(context, 1).edit().putBoolean("priority_call_9", true).commit()
        val manager = context.getSystemService(NotificationManager::class.java)
        org.robolectric.Shadows.shadowOf(manager).setNotificationPolicyAccessGranted(true)
        manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
        val call = VolnaCall("call", 1, VolnaUser(9, "peer", "Peer"), true, "ringing", null, null)
        assertNull(NativePriorityCalls.play(context, 1, call))
    }
}
