package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallerNameTest {
 @Test fun watchLookupUsesOnlyAnActualContactPhone(){
  assertEquals("+79681411241",nativeKnownContactPhone("+7 (968) 141-12-41"))
  assertNull(nativeKnownContactPhone("Любимая"))
  assertNull(nativeKnownContactPhone("sip:user123@volna.local"))
  assertNull(nativeKnownContactPhone("1234"))
 }
 @Test fun contactNamePrecedesProfileAndMissingNamesDoNotBecomeUsernames(){
  assertEquals("Любимая",nativeCallerName(" Любимая ","Елена","Елена Иванова"))
  assertEquals("Елена",nativeCallerName("","Елена","Елена Иванова"))
  assertEquals("Елена Иванова",nativeCallerName("","","Елена Иванова"))
  assertEquals("Собеседник",nativeCallerName("","",""))
 }
}
