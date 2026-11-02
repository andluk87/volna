package dev.volna.messenger
import android.app.Application
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
class NativeCallTelemetryTest {
 @Test fun candidateEventsContainOnlyTypeAndProtocol(){
  val result=nativeIceCandidateEvent("candidate:1 1 udp 123 192.168.1.10 49160 typ relay raddr 10.0.0.1 rport 1 ufrag PRIVATE")
  assertEquals("relay",result.getString("candidate_type"));assertEquals("udp",result.getString("protocol"));assertEquals(2,result.length());assertFalse(result.toString().contains("PRIVATE"));assertFalse(result.toString().contains("192.168"))
 }

 @Test fun fallbackIsAccountScopedBoundedAndExpires(){
  val body=org.json.JSONObject().put("event","rtc.state").put("report_id","a".repeat(32)).put("client_time",1000).put("ice","checking")
  val header=nativeCallDiagnosticHeader("session-one","session-one",body,2000);assertNotNull(header)
  val decoded=String(android.util.Base64.decode(header,android.util.Base64.URL_SAFE),Charsets.UTF_8);assertEquals("checking",org.json.JSONObject(decoded).getString("ice"));assertFalse(decoded.contains("session-one"))
  assertNull(nativeCallDiagnosticHeader("other-account","session-one",body,2000));assertNull(nativeCallDiagnosticHeader("session-one","session-one",body,122000));assertNull(nativeCallDiagnosticHeader("session-one","session-one",body.put("large","x".repeat(5000)),2000))
 }
 @Test fun candidateSummaryNeverIncludesAddressesOrCredentials(){
  val result=nativeCandidateSummary("v=0\r\na=ice-pwd:PRIVATE_PASSWORD\r\na=candidate:1 1 udp 123 192.168.1.2 1111 typ host\r\na=candidate:2 1 udp 123 5.188.38.29 49160 typ relay\r\na=candidate:3 1 tcp 123 5.188.38.29 49161 typ relay\r\n")
  assertEquals(2,result.getInt("relay_count"));assertEquals(1,result.getInt("host_count"));assertEquals(2,result.getInt("udp_count"));assertEquals(1,result.getInt("tcp_count"));assertFalse(result.toString().contains("PRIVATE"));assertFalse(result.toString().contains("192.168"))
 }
 @Test fun countersSelectedRelayAndRoundTripTimeAreSummarized(){
  val rows=listOf(NativeCallStat("local","local-candidate",mapOf("candidateType" to "relay","protocol" to "udp","address" to "PRIVATE")),NativeCallStat("pair","candidate-pair",mapOf("state" to "succeeded","nominated" to true,"localCandidateId" to "local","currentRoundTripTime" to .025)),NativeCallStat("out","outbound-rtp",mapOf("bytesSent" to 400L,"packetsSent" to 12L)),NativeCallStat("in","inbound-rtp",mapOf("bytesReceived" to 300L,"packetsReceived" to 10L,"packetsLost" to 2L)))
  val result=nativeCallStats(rows);assertEquals(400,result.getInt("bytes_sent"));assertEquals(300,result.getInt("bytes_received"));assertEquals(2,result.getInt("packets_lost"));assertEquals("relay",result.getString("candidate_type"));assertEquals("udp",result.getString("protocol"));assertEquals(25,result.getInt("rtt_ms"));assertFalse(result.toString().contains("PRIVATE"))
 }
}
