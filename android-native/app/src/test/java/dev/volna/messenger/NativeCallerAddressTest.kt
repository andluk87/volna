package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeCallerAddressTest {
 @Test fun disclosedPhoneOrVoipIdentityWithoutInventingNumbers(){
  assertEquals("tel:+79681411241",nativeCallerAddress("+7 (968) 141-12-41","andrey",12))
  assertEquals("sip:andrey@volna.local",nativeCallerAddress("","andrey",12))
  assertEquals("sip:andrey@volna.local",nativeCallerAddress("unknown1234567","andrey",12))
  assertEquals("sip:user12@volna.local",nativeCallerAddress("","bad@name",12))
 }
}
