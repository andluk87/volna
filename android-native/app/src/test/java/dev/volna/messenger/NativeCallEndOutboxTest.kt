package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(manifest=Config.NONE,sdk=[28])
class NativeCallEndOutboxTest {
 private val id="a".repeat(32)
 private val device="b".repeat(32)
 @Test fun survivesReloadAndSeparatesAccounts(){
  val prefs=RuntimeEnvironment.getApplication().getSharedPreferences("end-outbox-test",0);prefs.edit().clear().commit();var now=100000L
  var queue=NativeCallEndOutbox(prefs,"server_1"){now};queue.add(id,device,"user_hangup");queue.flush{throw IOException("offline")};assertTrue(queue.has(id))
  assertFalse(NativeCallEndOutbox(prefs,"server_2"){now}.has(id));now+=2000;queue=NativeCallEndOutbox(prefs,"server_1"){now}
  var sent=0;queue.flush{assertEquals(id,it.getString("call_id"));assertEquals(device,it.getString("device"));sent++};assertEquals(1,sent);assertFalse(queue.has(id));assertTrue(prefs.all.isEmpty())
 }
 @Test fun honorsRatePauseAndDoesNotReplayExpiredOrForbiddenEnds(){
  val prefs=RuntimeEnvironment.getApplication().getSharedPreferences("end-limits-test",0);prefs.edit().clear().commit();var now=100000L;val queue=NativeCallEndOutbox(prefs,"server_1"){now};queue.add(id,device,"user_hangup");queue.add(id,device,"user_hangup");var sent=0
  queue.flush{sent++;throw NativeApiException(429,"limited",retryAt=160000,serverTime=100000)};queue.flush(force=true){sent++};assertEquals(1,sent)
  now+=60000;queue.flush{throw NativeApiException(403,"other device")};assertFalse(queue.has(id))
  queue.add(id,device,"user_hangup");now+=86400001;queue.flush{fail("expired end sent")};assertFalse(queue.pending())
 }
}
