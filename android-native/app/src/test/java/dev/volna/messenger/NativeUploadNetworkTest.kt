package dev.volna.messenger

import android.app.Application
import kotlinx.coroutines.*
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
class NativeUploadNetworkTest {
    @Test fun cancellingUploadCancelsTheHttpSocketWithoutWaitingForResponse()=runBlocking {
        NativeCredentials.initialize(RuntimeEnvironment.getApplication())
        android.security.NetworkSecurityPolicy::class.java.getDeclaredMethod("setCleartextTrafficPermitted",Boolean::class.javaPrimitiveType).invoke(android.security.NetworkSecurityPolicy.getInstance(),true)
        val server=ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));val started=CountDownLatch(1);val closed=CountDownLatch(1)
        kotlin.concurrent.thread(isDaemon=true){try{server.accept().use{socket->socket.soTimeout=5000;val input=socket.getInputStream();val chunk=ByteArray(8192);if(input.read(chunk)>0)started.countDown();while(input.read(chunk)>=0){} }}catch(_:Exception){}finally{closed.countDown()}}
        try {
            val transfer=launch {NativeApi("http://127.0.0.1:${server.localPort}").uploadTracked("test","cancel.bin","application/octet-stream",ByteArray(4*1024*1024)){_,_->}}
            assertTrue(withContext(Dispatchers.IO){started.await(3,TimeUnit.SECONDS)})
            withTimeout(2000){transfer.cancelAndJoin()};assertTrue(transfer.isCancelled)
            assertTrue(withContext(Dispatchers.IO){closed.await(3,TimeUnit.SECONDS)})
        } finally {server.close()}
    }
}
