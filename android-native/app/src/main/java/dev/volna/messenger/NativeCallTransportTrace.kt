package dev.volna.messenger

import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

/** Fixed phase names only. Never retain URLs, addresses, headers or credentials. */
internal class NativeCallTransportTrace(private val now:()->Long=System::nanoTime):EventListener(){
 private val started=now()
 @Volatile var stage="authorization"
 fun elapsedMs()=maxOf(0L,TimeUnit.NANOSECONDS.toMillis(now()-started))
 override fun dnsStart(call:Call,domainName:String){stage="dns"}
 override fun connectStart(call:Call,inetSocketAddress:InetSocketAddress,proxy:Proxy){stage="connect"}
 override fun secureConnectStart(call:Call){stage="tls"}
 override fun connectionAcquired(call:Call,connection:Connection){stage="request"}
 override fun requestHeadersStart(call:Call){stage="request"}
 override fun responseHeadersStart(call:Call){stage="response_headers"}
}
internal class NativeCallTransportException(val transportStage:String,val elapsedMs:Long,cause:IOException):IOException("Не удалось связаться с сервером",cause)
