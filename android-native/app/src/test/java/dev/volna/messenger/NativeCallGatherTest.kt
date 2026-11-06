package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeCallGatherTest {
 @Test fun readyRelayDoesNotWaitForAnUnreachableAlternate(){
  assertNull(nativeRelayGatherDecision(false,2,199,500))
  assertEquals("relay_ready",nativeRelayGatherDecision(false,2,200,501))
 }
 @Test fun noRelayKeepsTheOriginalBoundAndCompleteReturnsImmediately(){
  assertNull(nativeRelayGatherDecision(false,0,5000,5000))
  assertEquals("timeout",nativeRelayGatherDecision(false,0,10000,10000))
  assertNull(nativeRelayGatherDecision(true,0,0,1))
  assertEquals("complete",nativeRelayGatherDecision(true,2,0,1))
  assertEquals("timeout",nativeRelayGatherDecision(true,0,10000,10000))
 }
}
