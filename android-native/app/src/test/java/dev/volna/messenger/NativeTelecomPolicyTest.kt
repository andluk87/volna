package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeTelecomPolicyTest {
    private fun state(id: String = "new", incoming: Boolean = true, status: String = "ringing", busy: Boolean = false) = NativeCallState(call = VolnaCall(id, 1, null, incoming, status, null, null), busy = busy)
    @Test fun staleHardwareCommandCannotEndANewCall() {
        assertFalse(nativeTelecomActionAllowed(state(), "old"))
        assertFalse(nativeTelecomActionAllowed(NativeCallState(), "new"))
        assertTrue(nativeTelecomActionAllowed(state(status = "active"), "new"))
    }
    @Test fun answerOnlyAppliesToAnIdleIncomingRingingCall() {
        assertTrue(nativeTelecomActionAllowed(state(), "new", true))
        assertFalse(nativeTelecomActionAllowed(state(busy = true), "new", true))
        assertFalse(nativeTelecomActionAllowed(state(incoming = false), "new", true))
        assertFalse(nativeTelecomActionAllowed(state(status = "active"), "new", true))
    }
}
