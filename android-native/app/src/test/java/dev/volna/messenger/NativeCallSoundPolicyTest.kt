package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeCallSoundPolicyTest {
 @Test fun terminalSoundsDistinguishBusyFailureNormalEndAndOtherDevice(){
  assertEquals("busy",nativeCallEndTone("call_busy",false));assertEquals("busy",nativeCallEndTone("server_declined"))
  assertEquals("failed",nativeCallEndTone("connect_timeout"));assertEquals("end",nativeCallEndTone("user_hangup"))
  assertEquals("",nativeCallEndTone("other_device"));assertEquals("",nativeCallEndTone("session_reset"))
 }
}
