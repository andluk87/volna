package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeBackgroundCallsTest {
 @Test fun backgroundCallsKeepTheirAccountAndClearIndependently(){
  NativeBackgroundCalls.calls.value=emptyMap()
  val one=VolnaCall("one",11,null,true,"ringing",null,null)
  val two=VolnaCall("two",22,null,true,"ringing",null,null)
  NativeBackgroundCalls.put(1,"Личный",one);NativeBackgroundCalls.put(2,"Рабочий",two)
  assertEquals("Рабочий",NativeBackgroundCalls.calls.value[2L]?.name)
  assertEquals("two",NativeBackgroundCalls.calls.value[2L]?.call?.id)
  NativeBackgroundCalls.remove(1)
  assertEquals(setOf(2L),NativeBackgroundCalls.calls.value.keys)
  NativeBackgroundCalls.remove(2);assertTrue(NativeBackgroundCalls.calls.value.isEmpty())
 }
}
