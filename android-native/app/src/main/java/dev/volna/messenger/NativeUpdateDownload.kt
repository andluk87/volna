package dev.volna.messenger

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

internal const val NativeMaxUpdateApkBytes = 256L * 1024 * 1024

/** Stream APKs to disk with a bounded buffer; both HTTP length and actual bytes are checked. */
internal fun copyNativeUpdateApk(input: InputStream, output: OutputStream, expectedSha256: String,
    declaredLength: Long = -1, maximumBytes: Long = NativeMaxUpdateApkBytes): Long {
    check(declaredLength <= maximumBytes) { "Размер APK превышает допустимый (256 МиБ)" }
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        total += count
        check(total <= maximumBytes) { "Размер APK превышает допустимый (256 МиБ)" }
        digest.update(buffer, 0, count)
        output.write(buffer, 0, count)
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    check(total > 0 && actual == expectedSha256) { "Контрольная сумма обновления не совпала" }
    return total
}
