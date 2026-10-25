package dev.volna.messenger

import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class NativeQrLoginTest {
    private val qr = "volna://login/" + "A".repeat(43)

    @Test fun cameraScanApprovesImmediatelyAfterServerValidation() = runTest {
        val actions = mutableListOf<String>()
        nativeAuthorizeScannedQr(qr, { actions.add("scan:$it") }, { actions.add("approve:$it") })
        assertEquals(listOf("scan:$qr", "approve:$qr"), actions)
    }

    @Test fun invalidQrAndFailedScanNeverApprove() = runTest {
        var scans = 0; var approvals = 0
        for (invalid in listOf("https://example.com", "volna://login/short", qr + "/extra")) {
            val failure = runCatching { nativeAuthorizeScannedQr(invalid, { scans++ }, { approvals++ }) }.exceptionOrNull()
            assertTrue(failure is IllegalArgumentException)
        }
        assertEquals(0, scans)
        val failure = runCatching {
            nativeAuthorizeScannedQr(qr, { error("QR expired or belongs to another account") }, { approvals++ })
        }.exceptionOrNull()
        assertEquals("QR expired or belongs to another account", failure?.message)
        assertEquals(0, approvals)
    }

    @Test fun cancellationBetweenScanAndApprovalDoesNotLinkADevice() = runTest {
        var approvals = 0
        val job = launch {
            nativeAuthorizeScannedQr(qr, { currentCoroutineContext().cancel() }, { approvals++ })
        }
        job.join()
        assertTrue(job.isCancelled)
        assertEquals(0, approvals)
    }
}
