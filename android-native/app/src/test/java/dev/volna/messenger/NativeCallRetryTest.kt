package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallRetryTest {
    @Test fun networkResponseLossRepeatsTheSameCommandOnce() {
        val command=Any(); val seen=mutableListOf<Any>()
        val result=nativeRetryCallMutation { seen.add(command); if(seen.size==1)throw java.io.IOException("lost response"); command }
        assertSame(command,result);assertEquals(2,seen.size);assertSame(seen[0],seen[1])
    }
    @Test fun noRetryForBusinessErrorOrUnboundedLoop() {
        var calls=0
        try { nativeRetryCallMutation<Unit> { calls++; throw NativeApiException(409,"already answered") };fail() } catch(_:NativeApiException){}
        assertEquals(1,calls);calls=0
        try { nativeRetryCallMutation<Unit> { calls++; throw java.io.IOException("offline") };fail() } catch(_:java.io.IOException){}
        assertEquals(2,calls)
    }
}
