package dev.volna.messenger
import org.junit.Assert.assertEquals
import org.junit.Test
class NativeSmsPhoneTest {
    @Test fun russianNumbersHaveOneCountryCode() {
        for (raw in listOf("9001234567", "+7 (900) 123-45-67", "79001234567", "89001234567")) {
            assertEquals("+79001234567", nativeSmsPhone("+7", raw))
        }
    }
    @Test fun explicitInternationalNumberOverridesSelectedCountry() {
        assertEquals("+4915123456789", nativeSmsPhone("+7", "+49 151 23456789"))
        assertEquals("+375291234567", nativeSmsPhone("+375", "291234567"))
    }
    @Test(expected = IllegalArgumentException::class) fun duplicatePrefixIsRejected() { nativeSmsPhone("+7", "779001234567") }
    @Test(expected = IllegalArgumentException::class) fun shortPhoneIsRejected() { nativeSmsPhone("+7", "123456") }
    @Test(expected = IllegalArgumentException::class) fun invalidCountryLengthIsRejected() { nativeSmsPhone("+1", "202555012345") }
    @Test(expected = IllegalArgumentException::class) fun misplacedPlusIsRejected() { nativeSmsPhone("+7", "900+1234567") }
}
