package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeCallAudioMonitorTest {
 @Test fun firstPacketStallResumeAndCounterReset(){
  val monitor=NativeCallAudioMonitor(0)
  assertNull(monitor.observe(null,0));assertNull(monitor.observe(0,30000));assertEquals("audio_first_packet" to 31000L,monitor.observe(5,31000))
  assertNull(monitor.observe(5,50000));assertEquals("audio_stalled" to 20000L,monitor.observe(5,51000));assertNull(monitor.observe(5,60000));assertNull(monitor.observe(0,61000));assertEquals("audio_resumed" to null,monitor.observe(1,62000))
 }
}
