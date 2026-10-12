package dev.volna.messenger
import org.junit.Test
import org.junit.Assert.*
class NativeNotificationReplyTest {
 @Test fun retryUsesSameKeyButDifferentAccountsMessagesAndRepliesRemainIndependent(){
  val key=nativeNotificationReplyId(1,2,3,"Ответ")
  assertEquals(key,nativeNotificationReplyId(1,2,3,"Ответ"))
  assertNotEquals(key,nativeNotificationReplyId(4,2,3,"Ответ"))
  assertNotEquals(key,nativeNotificationReplyId(1,5,3,"Ответ"))
  assertNotEquals(key,nativeNotificationReplyId(1,2,6,"Ответ"))
  assertNotEquals(key,nativeNotificationReplyId(1,2,3,"Другой ответ"))
  assertTrue(key.matches(Regex("[a-f0-9]{32}")))
 }
}
