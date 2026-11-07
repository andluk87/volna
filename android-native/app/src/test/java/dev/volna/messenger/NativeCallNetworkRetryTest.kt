package dev.volna.messenger

import java.io.IOException
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class NativeCallNetworkRetryTest {
 @Test fun retriesOutageAndKeepsCancellationFinal()= runBlocking {
  var clock=0L;var attempts=0
  val value=nativeCallNetworkRetry(valid={true},now={clock},pause={clock+=it}){if(++attempts<4)throw IOException("offline");"connected"}
  assertEquals("connected",value);assertEquals(3000L,clock)
  try{nativeCallNetworkRetry(valid={false},now={clock}){fail("cancelled action executed")};fail("expected cancellation")}catch(expected:CancellationException){}
 }
 @Test fun outageHasBoundedDeadline()= runBlocking {
  var clock=0L
  try{nativeCallNetworkRetry(valid={true},now={clock},pause={clock+=it}){throw IOException("offline")};fail("expected timeout")}catch(expected:IOException){assertEquals(180000L,clock)}
 }
 @Test fun rateLimitUsesServerClockAndDeadline()= runBlocking {
  var clock=0L;var attempts=0
  val value=nativeCallNetworkRetry(valid={true},now={clock},pause={clock+=it}){if(++attempts==1)throw NativeApiException(429,"limited",retryAt=160000,serverTime=100000);"ok"}
  assertEquals("ok",value);assertEquals(60000L,clock)
  attempts=0;clock=0
  try{nativeCallNetworkRetry(valid={true},now={clock},pause={clock+=it}){attempts++;throw NativeApiException(429,"limited",retryAt=400000,serverTime=100000)};fail("expected deadline")}catch(expected:NativeApiException){assertEquals(180000L,clock);assertEquals(1,attempts)}
 }
 @Test fun emojisAreFourAndDeterministic(){
  assertEquals("🍡 🐜 🐅 🐖",nativeCallSafetyEmojis("741D · 4E0E · 0821 · 471C"))
  assertEquals("",nativeCallSafetyEmojis(""))
 }
}
