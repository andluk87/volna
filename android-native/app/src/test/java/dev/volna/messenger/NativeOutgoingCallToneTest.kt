package dev.volna.messenger
import org.junit.Assert.assertEquals
import org.junit.Test
class NativeOutgoingCallToneTest {
 @Test fun waitForDeviceBeforeRingback(){
  assertEquals("setup",nativeOutgoingCallTone(false,"preparing",false,false))
  assertEquals("setup",nativeOutgoingCallTone(false,"ringing",false,false))
  assertEquals("ringback",nativeOutgoingCallTone(false,"ringing",true,false))
  for(status in listOf("connecting","active","ended"))assertEquals("",nativeOutgoingCallTone(false,status,true,false))
  assertEquals("",nativeOutgoingCallTone(false,"ringing",true,true))
  assertEquals("",nativeOutgoingCallTone(true,"ringing",true,false))
 }
}
