package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeCallPollingTest {
    @Test fun negotiationAndRecoveryUseShortFallbackEvenWithoutSse(){
        assertEquals(500L,nativeCallPollDelay(true,false,false))
        assertEquals(500L,nativeCallPollDelay(true,true,true))
    }
    @Test fun connectedCallsAndIdleClientsKeepNormalHeartbeatLoad(){
        assertEquals(2000L,nativeCallPollDelay(true,true,false))
        assertEquals(2000L,nativeCallPollDelay(false,false,false))
    }
}
