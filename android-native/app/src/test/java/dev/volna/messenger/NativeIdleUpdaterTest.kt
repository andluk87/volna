package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeIdleUpdaterTest {
 @Test fun idleInstallRequiresConsentAndProtectsCallsAndTransfers(){
  assertTrue(nativeIdleUpdateAllowed(true,true,600_000,false,false))
  assertFalse(nativeIdleUpdateAllowed(false,true,600_000,false,false))
  assertFalse(nativeIdleUpdateAllowed(true,false,600_000,false,false))
  assertFalse(nativeIdleUpdateAllowed(true,true,599_999,false,false))
  assertFalse(nativeIdleUpdateAllowed(true,true,600_000,true,false))
  assertFalse(nativeIdleUpdateAllowed(true,true,600_000,false,true))
 }
}
