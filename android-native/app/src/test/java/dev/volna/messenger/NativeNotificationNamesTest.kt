package dev.volna.messenger

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeNotificationNamesTest {
    @Test fun personalContactNamePrecedesTheProfileWithoutShowingLoginHandles() {
        assertEquals("Любимая", nativeNotificationName(custom = " Любимая ", phonebook = "Елена", profile = "Елена Иванова", username = "elena"))
        assertEquals("Елена", nativeNotificationName(custom = "", phonebook = "Елена", profile = "elena", username = "elena"))
        assertEquals("ELENA", nativeNotificationName(custom = "ELENA", profile = "elena", username = "elena"))
        assertEquals("Елена Иванова", nativeNotificationName(profile = "Елена Иванова (@elena)", username = "elena"))
    }

    @Test fun missingNamesUseSafeLabelsWhileHumanFirstAndLastNamesRemain() {
        assertEquals("@unknown", nativeNotificationName(profile = "@unknown"))
        assertEquals("+7 (968) 141-12-41", nativeNotificationName(profile = "+7 (968) 141-12-41"))
        assertEquals("and_luk", nativeNotificationName(profile = "and_luk", username = "and_luk", fallback = "Аккаунт"))
        assertEquals("Андрей Лукашук", nativeNotificationName(profile = "and_luk", username = "and_luk", firstName = "Андрей", lastName = "Лукашук"))
        assertEquals("Иван Иван", nativeNotificationName(username = "ivan", firstName = "Иван", lastName = "Иван"))
        assertEquals("Anna", nativeNotificationName(username = "anna", firstName = "Anna"))
    }

    @Test fun legacyDisplayNamesAndCachedNamesIdentifyTheSender() {
        assertEquals("elena", nativeNotificationName(profile = "elena", username = "elena"))
        assertEquals("Любимая", nativeNotificationName(profile = "Пользователь", alternateNames = listOf("", "Любимая")))
        assertEquals("Елена", nativeNotificationName(profile = "Елена · @elena", username = "elena"))
        assertEquals("Аккаунт", nativeNotificationName(username = "elena", fallback = "Аккаунт"))
    }

    @Test fun topicTitlesRemainDistinctFromPersonNames() {
        assertEquals("Новости › Обновления", nativeNotificationTitle("Елена", "Новости", "Обновления", true))
        assertEquals("Новости", nativeNotificationTitle("Елена", "Новости", "", true))
        assertEquals("Елена", nativeNotificationTitle("Елена", "Новости", "Обновления", false))
    }
    @Test fun optionalWaveMarkIsTextAndDefaultsToAnUnchangedTitle() {
        assertEquals("Елена",nativeNotificationBrandTitle("Елена",false))
        assertEquals("🌊 VLN · Елена",nativeNotificationBrandTitle("Елена",true))
    }
}
