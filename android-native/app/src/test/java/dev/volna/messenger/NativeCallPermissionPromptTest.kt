package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallPermissionPromptTest {
 @Test fun updatesRecheckMissingPermissionsWithoutPromptingWhenGranted(){
  assertTrue(nativeCallPermissionPrompt(false,false,12033,12034,true))
  assertFalse(nativeCallPermissionPrompt(true,true,12033,12034,true))
  assertTrue(nativeCallPermissionPrompt(false,false,-1,12034,false))
  assertFalse(nativeCallPermissionPrompt(false,false,12034,12034,true))
  assertTrue(nativeCallPermissionPrompt(false,true,12034,12034,true))
 }
}
