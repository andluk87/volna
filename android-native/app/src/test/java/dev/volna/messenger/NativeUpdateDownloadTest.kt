package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

class NativeUpdateDownloadTest {
    private class Zeros(private var remaining: Long) : InputStream() {
        override fun read(): Int = if (remaining-- > 0) 0 else -1
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0) return -1
            val count = minOf(remaining, length.toLong()).toInt()
            bytes.fill(0, offset, offset + count); remaining -= count
            return count
        }
    }
    @Test fun apkLargerThanTheOldLimitDownloadsWithoutBufferingTheWholeFile() {
        val size = 137L * 1024 * 1024
        val digest = MessageDigest.getInstance("SHA-256")
        val block = ByteArray(64 * 1024)
        repeat((size / block.size).toInt()) { digest.update(block) }
        val expected = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
        var bytesWritten = 0L
        val sink = object : OutputStream() {
            override fun write(value: Int) { bytesWritten++ }
            override fun write(bytes: ByteArray, offset: Int, length: Int) { bytesWritten += length }
        }
        assertEquals(size, copyNativeUpdateApk(Zeros(size), sink, expected, size))
        assertEquals(size, bytesWritten)
    }
    @Test fun oversizedContentLengthIsRejectedBeforeReadingTheBody() {
        val input = object : InputStream() { override fun read(): Int = error("must not read") }
        val error = assertThrows(IllegalStateException::class.java) { copyNativeUpdateApk(input, ByteArrayOutputStream(), "", NativeMaxUpdateApkBytes + 1) }
        assertTrue(error.message!!.contains("размер", ignoreCase = true))
    }
    @Test fun unknownLengthStillCannotExceedTheStreamingLimit() {
        val error = assertThrows(IllegalStateException::class.java) { copyNativeUpdateApk(Zeros(1025), ByteArrayOutputStream(), "", maximumBytes = 1024) }
        assertTrue(error.message!!.contains("размер", ignoreCase = true))
    }
    @Test fun truncatedOrCorruptApksCannotPassChecksumValidation() {
        assertThrows(IllegalStateException::class.java) { copyNativeUpdateApk(ByteArrayInputStream(byteArrayOf(1, 2, 3)), ByteArrayOutputStream(), "0".repeat(64)) }
        assertThrows(IllegalStateException::class.java) { copyNativeUpdateApk(ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream(), "0".repeat(64)) }
    }
}
