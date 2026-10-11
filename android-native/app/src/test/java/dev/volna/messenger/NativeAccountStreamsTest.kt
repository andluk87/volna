package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeAccountStreamsTest {
 @Test fun switchingUiDoesNotRemoveAnyStoredAccountStream() { assertTrue(nativeStreamsToStop(mapOf(1L to "a",2L to "b"),mapOf(1L to "a",2L to "b")).isEmpty()) }
 @Test fun loggingOutOfOneAccountKeepsTheOther() { assertEquals(setOf(1L),nativeStreamsToStop(mapOf(2L to "b"),mapOf(1L to "a",2L to "b"))) }
 @Test fun tokenRotationRestartsOnlyItsAccount() { assertEquals(setOf(2L),nativeStreamsToStop(mapOf(1L to "a",2L to "c"),mapOf(1L to "a",2L to "b"))) }
}
