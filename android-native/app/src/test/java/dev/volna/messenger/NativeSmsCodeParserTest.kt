package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeSmsCodeParserTest {
    private val hash = "AbCdEfGhIjK"
    private fun message(code: String = "001234", nonce: String = "abcdefgh", app: String = hash) = "$code твоя волна Попытка: $nonce $app"
    @Test fun ownMessagePreservesLeadingZeros() { assertEquals("001234", NativeSmsCodeParser.parse(message(), "abcdefgh", hash)) }
    @Test fun ignoresOtherAttemptsAndCertificates() {
        assertNull(NativeSmsCodeParser.parse(message(nonce = "previous"), "abcdefgh", hash))
        assertNull(NativeSmsCodeParser.parse(message(app = "Z".repeat(11)), "abcdefgh", hash))
        assertNull(NativeSmsCodeParser.parse("Telegram code: 001234\n$hash", "abcdefgh", hash))
        assertNull(NativeSmsCodeParser.parse("001-234 твоя волна", "abcdefgh", hash))
    }
    @Test fun refusesArbitraryNumbersMultipleCodesAndMalformedMessages() {
        for (text in listOf(message(code = "12345"), message(code = "1234567"), "Order 123456\n" + message(), message() + " 987654", message(nonce = "abc"), "x".repeat(141))) assertNull(NativeSmsCodeParser.parse(text, "abcdefgh", hash))
    }
    @Test fun consentStillRequiresOwnAppFormatAndCurrentNonce() {
        assertEquals("001234", NativeSmsCodeParser.parse(message().substringBeforeLast(' '), "abcdefgh"))
        assertNull(NativeSmsCodeParser.parse(message(nonce = "previous").substringBeforeLast(' '), "abcdefgh"))
    }
    @Test fun supportsAndroidLineEndings() { assertEquals("001234", NativeSmsCodeParser.parse("<#> Код входа в Волна: 001234\r\nПопытка: abcdefgh\r\n$hash", "abcdefgh", hash)) }
    @Test fun appHashMatchesGoogleSha256CertificateAlgorithm() {
        assertEquals("1wxp9x8NRby", NativeSmsCodeParser.appHash("dev.volna.messenger", "010203"))
    }
}
