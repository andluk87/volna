package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class NativeCrashTraceTest {
    private fun join(vararg parts: ByteArray) = parts.fold(byteArrayOf()) { all, part -> all + part }
    private fun varint(value: Long): ByteArray {
        var remaining = value
        val bytes = mutableListOf<Byte>()
        do {
            val low = (remaining and 127).toInt()
            remaining = remaining ushr 7
            bytes.add((low or if (remaining != 0L) 128 else 0).toByte())
        } while (remaining != 0L)
        return bytes.toByteArray()
    }
    private fun number(field: Int, value: Long) = join(varint((field * 8).toLong()), varint(value))
    private fun bytes(field: Int, value: ByteArray) = join(varint((field * 8 + 2).toLong()), varint(value.size.toLong()), value)
    private fun text(field: Int, value: String) = bytes(field, value.toByteArray())
    private fun thread(id: Long, frames: Int = 1): ByteArray {
        val frame = join(number(1, 0x1234), text(4, "webrtc::CreateOffer"), number(5, 16), text(6, "/data/app/private/lib/arm64/libjingle_peerconnection_so.so"), text(8, "abcdef"))
        val value = join(number(1, id), text(2, "signaling_thread"), *Array(frames) { bytes(4, frame) }, text(5, "private memory"))
        return bytes(16, join(number(1, id), bytes(2, value)))
    }

    @Test fun readsCrashingThreadSignalAndBuildIdWithUnorderedFields() {
        val signal = join(number(1, 6), text(2, "SIGABRT"), number(3, -6), text(4, "SI_TKILL"))
        val dump = join(thread(41), bytes(10, signal), text(14, "Check failed: fixture"), number(6, 41))
        val report = NativeCrashTrace.read(ByteArrayInputStream(dump))
        assertTrue(report.contains("SIGABRT (6), SI_TKILL (-6)"))
        assertTrue(report.contains("Check failed: fixture"))
        assertTrue(report.contains("Поток сбоя: 41"))
        assertTrue(report.contains("pc 0000000000001234 libjingle_peerconnection_so.so (webrtc::CreateOffer+16) [BuildId: abcdef]"))
        assertFalse(report.contains("/data/app/private"))
    }

    @Test fun skipsOtherThreadsMemoryLogsAndUnknownFields() {
        val other = bytes(16, join(number(1, 99), bytes(2, text(2, "secret-other-thread"))))
        val dump = join(number(6, 41), other, thread(41), text(17, "secret-mapping"), text(18, "secret-log"), text(9, "secret-command"), number(900, 123))
        val report = NativeCrashTrace.parse(dump)
        assertFalse(report.contains("secret"))
        assertFalse(report.contains("private memory"))
        assertTrue(report.contains("webrtc::CreateOffer"))
    }

    @Test fun limitsTheNumberOfStackFrames() {
        val report = NativeCrashTrace.parse(join(number(6, 41), thread(41, 60)))
        assertEquals(32, Regex("(?m)^#[0-9]+ ").findAll(report).count())
        assertFalse(report.contains("#32 "))
    }

    @Test fun rejectsTruncatedMessagesAndInvalidVarints() {
        val valid = join(number(6, 41), thread(41))
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.parse(valid.copyOf(valid.size - 1)) }
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.parse(byteArrayOf(48, -128)) }
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.parse(byteArrayOf(48) + ByteArray(10) { -128 }) }
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.parse(byteArrayOf(0)) }
    }

    @Test fun rejectsOversizedStreamsAndMissingCrashThread() {
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.read(ByteArrayInputStream(ByteArray(2 * 1024 * 1024 + 1))) }
        assertThrows(IllegalArgumentException::class.java) { NativeCrashTrace.parse(byteArrayOf()) }
        assertTrue(NativeCrashTrace.parse(number(6, 41)).contains("Стек потока отсутствует"))
    }

    @Test fun skipsUnknownFixedWidthValues() {
        val fixed = join(varint(901L * 8 + 1), ByteArray(8), varint(902L * 8 + 5), ByteArray(4))
        assertTrue(NativeCrashTrace.parse(join(fixed, number(6, 41), thread(41))).contains("Поток сбоя: 41"))
    }
}
