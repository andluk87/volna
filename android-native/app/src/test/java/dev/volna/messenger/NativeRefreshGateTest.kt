package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.TimeoutException

class NativeRefreshGateTest {
    @Test fun installationWaitsForRefreshPersistenceAndBlocksFurtherRotation() {
        val gate = NativeRefreshGate()
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            var persisted = false
            val refresh = executor.submit { gate.refresh { entered.countDown(); check(release.await(5, TimeUnit.SECONDS)); persisted = true } }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val attempted = CountDownLatch(1)
            val install = executor.submit { attempted.countDown(); gate.install { check(persisted) } }
            assertTrue(attempted.await(5, TimeUnit.SECONDS))
            assertThrows(TimeoutException::class.java) { install.get(100, TimeUnit.MILLISECONDS) }
            release.countDown()
            refresh.get(5, TimeUnit.SECONDS); install.get(5, TimeUnit.SECONDS)
            assertThrows(IOException::class.java) { gate.refresh { fail("Must not rotate during install") } }
            gate.resume()
            assertEquals("connected", gate.refresh { "connected" })
        } finally { release.countDown(); executor.shutdownNow() }
    }

    @Test fun failedInstallerCommitDoesNotBlockSessionRecovery() {
        val gate = NativeRefreshGate()
        assertThrows(IllegalStateException::class.java) { gate.install { error("Installer rejected update") } }
        assertEquals("connected", gate.refresh { "connected" })
    }
}
