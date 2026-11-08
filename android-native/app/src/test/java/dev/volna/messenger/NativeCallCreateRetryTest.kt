package dev.volna.messenger

import android.app.Application
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.net.ServerSocket
import java.util.Collections

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28],application=Application::class)
class NativeCallCreateRetryTest {
 @Test fun transientFailuresKeepTheSameLogicalStartAcrossOuterRetries()=runBlocking {
  NativeCredentials.initialize(RuntimeEnvironment.getApplication())
  val server=ServerSocket(0);val seen=Collections.synchronizedList(mutableListOf<String>())
  val worker=Thread{repeat(3){server.accept().use{socket->
   val input=socket.getInputStream().bufferedReader();input.readLine();var length=0
   while(true){val line=input.readLine()?:break;if(line.isEmpty())break;if(line.startsWith("Content-Length:",true))length=line.substringAfter(':').trim().toInt()}
   val chars=CharArray(length);var offset=0;while(offset<length){val n=input.read(chars,offset,length-offset);if(n<0)break;offset+=n}
   val data=JSONObject(String(chars));seen+=data.getString("client_id")
   val status=if(seen.size<3)503 else 200
   val body=if(status==503)"{\"error\":\"temporary\"}" else "{\"id\":\"${"a".repeat(32)}\",\"chat_id\":1,\"incoming\":false,\"status\":\"preparing\"}"
   val bytes=body.toByteArray();socket.getOutputStream().apply{write("HTTP/1.1 $status OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
  }}};worker.isDaemon=true;worker.start()
  try{
   val api=NativeApi("http://127.0.0.1:${server.localPort}",requestTimeoutSeconds=3);var clock=0L
   val call=nativeCallNetworkRetry(valid={true},now={clock},pause={clock+=it}){api.startCall("test","b".repeat(32),1,clientId="one-stable-client-key")}
   assertEquals("a".repeat(32),call.id);assertEquals(listOf("one-stable-client-key","one-stable-client-key","one-stable-client-key"),seen);assertEquals(1000L,clock)
  }finally{server.close();worker.join(1000)}
 }
 @Test fun transportExceptionPreservesTimeoutAndFixedPhase(){
  var nanos=1000000000L;val trace=NativeCallTransportTrace{nanos};trace.stage="auth_refresh";nanos+=15000000000L
  val cause=java.io.InterruptedIOException("timeout");val failure=NativeCallTransportException(trace.stage,trace.elapsedMs(),cause)
  assertEquals("auth_refresh",failure.transportStage);assertEquals(15000L,failure.elapsedMs);assertSame(cause,failure.cause)
 }
}
