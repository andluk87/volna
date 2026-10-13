package dev.volna.messenger

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeNotificationNamesTest {
    @Test fun personalContactNamePrecedesTheProfileWithoutShowingLoginHandles() {
        assertEquals("Любимая", nativeNotificationName(custom = " Любимая ", phonebook = "Елена", profile = "Елена Иванова", username = "elena"))
        assertEquals("Елена", nativeNotificationName(custom = "@elena", phonebook = "Елена", profile = "elena", username = "elena"))
        assertEquals("Пользователь", nativeNotificationName(custom = "ELENA", profile = "elena", username = "elena"))
        assertEquals("Елена Иванова", nativeNotificationName(profile = "Елена Иванова (@elena)", username = "elena"))
    }

    @Test fun missingNamesUseSafeLabelsWhileHumanFirstAndLastNamesRemain() {
        assertEquals("Пользователь", nativeNotificationName(profile = "@unknown"))
        assertEquals("Пользователь", nativeNotificationName(profile = "+7 (968) 141-12-41"))
        assertEquals("Аккаунт", nativeNotificationName(profile = "and_luk", username = "and_luk", fallback = "Аккаунт"))
        assertEquals("Андрей Лукашук", nativeNotificationName(profile = "and_luk", username = "and_luk", firstName = "Андрей", lastName = "Лукашук"))
        assertEquals("Иван Иван", nativeNotificationName(username = "ivan", firstName = "Иван", lastName = "Иван"))
        assertEquals("Anna", nativeNotificationName(username = "anna", firstName = "Anna"))
    }

    @Test fun topicTitlesRemainDistinctFromPersonNames() {
        assertEquals("Новости › Обновления", nativeNotificationTitle("Елена", "Новости", "Обновления", true))
        assertEquals("Новости", nativeNotificationTitle("Елена", "Новости", "", true))
        assertEquals("Елена", nativeNotificationTitle("Елена", "Новости", "Обновления", false))
    }
    @Test fun optionalWaveMarkIsTextAndDefaultsToAnUnchangedTitle() {
        assertEquals("Елена",nativeNotificationBrandTitle("Елена",false))
        assertEquals("🌊 Волна · Елена",nativeNotificationBrandTitle("Елена",true))
    }
}
