package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeCallSessionPolicyTest {
    private val resolve:(String)->String = { when(it){"old-access","new-access"->"new-access";"other-access"->"other-access";else->it} }
    @Test fun openingIncomingCallAfterRefreshKeepsTheExistingCall() {
        assertTrue(nativeSameCallSession("old-access","new-access",resolve))
        assertEquals(NativeCallConfiguration.KEEP,nativeCallConfiguration(true,"old-access","new-access",true,resolve))
    }
    @Test fun oldActivityAndNewServiceHandlesRemainEquivalentInBothDirections() {
        assertEquals(NativeCallConfiguration.KEEP,nativeCallConfiguration(true,"new-access","old-access",true,resolve))
        assertEquals(NativeCallConfiguration.KEEP,nativeCallConfiguration(true,"old-access","new-access",false,resolve))
    }
    @Test fun aDifferentAccountCannotReplaceTheOwnerOfAnActiveCall() {
        assertFalse(nativeSameCallSession("old-access","other-access",resolve))
        assertEquals(NativeCallConfiguration.BLOCK,nativeCallConfiguration(true,"old-access","other-access",true,resolve))
        assertEquals(NativeCallConfiguration.RESET,nativeCallConfiguration(true,"old-access","other-access",false,resolve))
    }
    @Test fun logoutStillReleasesTheCallAndEmptyResolvedCredentialsDoNotMatch() {
        assertEquals(NativeCallConfiguration.RESET,nativeCallConfiguration(true,"old-access","",true,resolve))
        assertFalse(nativeSameCallSession("old-access","new-access"){""})
        assertEquals(NativeCallConfiguration.BLOCK,nativeCallConfiguration(true,"old-access","new-access",true){""})
    }
    @Test fun initialConfigurationAndRepeatedConfigurationPreserveTheirLifecycle() {
        assertEquals(NativeCallConfiguration.RESET,nativeCallConfiguration(false,"new-access","new-access",false,resolve))
        assertEquals(NativeCallConfiguration.KEEP,nativeCallConfiguration(true,"new-access","new-access",true,resolve))
        assertEquals(NativeCallConfiguration.KEEP,nativeCallConfiguration(true,"","",false,resolve))
    }
}
