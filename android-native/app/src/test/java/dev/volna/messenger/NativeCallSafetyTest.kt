package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallSafetyTest {
    private fun sdp(byte: String) = "v=0\r\na=fingerprint:sha-256 " + List(32) { byte }.joinToString(":") + "\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    @Test fun sharedVectorBindsCallAndBothKeys() {
        val id="a".repeat(32)
        val code=nativeCallSafetyCode(id,sdp("AA"),sdp("BB"))
        assertEquals("741D · 4E0E · 0821 · 471C", code)
        assertEquals(code,nativeCallSafetyCode(id,sdp("BB"),sdp("AA")))
        assertNotEquals(code,nativeCallSafetyCode("b".repeat(32),sdp("AA"),sdp("BB")))
        assertNotEquals(code,nativeCallSafetyCode(id,sdp("AC"),sdp("BB")))
        assertEquals("",nativeCallSafetyCode(id,sdp("AA"),null))
        assertEquals("",nativeCallSafetyCode(id,sdp("AA")+sdp("BB"),sdp("AA")))
    }
}
