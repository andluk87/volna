package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeContactPhoneTest {
    @Test fun russianLocalAndInternationalFormsMatch() {
        assertEquals("+79991234567", nativeContactPhone("8 (999) 123-45-67", "RU"))
        assertEquals("+79991234567", nativeContactPhone("9991234567", "RU"))
        assertEquals("+79991234567", nativeContactPhone("+7 999 123 45 67", "RU"))
    }
    @Test fun internationalCountryIsPreserved() {
        assertEquals("+442079460958", nativeContactPhone("+44 20 7946 0958", "RU"))
        assertEquals("+12025550123", nativeContactPhone("(202) 555-0123", "US"))
    }
    @Test fun malformedPhoneNeverBecomesADiscoveryQuery() {
        assertNull(nativeContactPhone("123", "RU")); assertNull(nativeContactPhone("не номер", "RU"))
    }
}
