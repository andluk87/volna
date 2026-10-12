package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeUpdateRelaunchTest{
 @Test fun relaunchOnlyForRecentUserInitiatedSuccessfulUpgrade(){
  assertTrue(nativeUpdateRelaunch(12037,12038,1000,2000))
  assertFalse(nativeUpdateRelaunch(12037,12037,1000,2000))
  assertFalse(nativeUpdateRelaunch(12037,12038,0,2000))
  assertFalse(nativeUpdateRelaunch(12037,12038,1000,1000+31*60*1000))
 }
}
