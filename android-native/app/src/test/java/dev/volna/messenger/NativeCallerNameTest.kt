package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallerNameTest {
 @Test fun contactNamePrecedesProfileAndMissingNamesDoNotBecomeUsernames(){
  assertEquals("Любимая",nativeCallerName(" Любимая ","Елена","Елена Иванова"))
  assertEquals("Елена",nativeCallerName("","Елена","Елена Иванова"))
  assertEquals("Елена Иванова",nativeCallerName("","","Елена Иванова"))
  assertEquals("Собеседник",nativeCallerName("","",""))
 }
}
