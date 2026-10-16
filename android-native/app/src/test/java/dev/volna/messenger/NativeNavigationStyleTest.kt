package dev.volna.messenger

import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeNavigationStyleTest {
    @Test fun accountPreferencesRoundTripIndependentStyles() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("navigation-style", 0)
        prefs.edit().clear().commit()
        val value = NativeAppearance(theme = "dark", radius = 22,
            foldersStyle = NativeNavigationStyle.Folders.copy(height = 56, selected = 0xFF7755AAL, labels = false),
            navigationStyle = NativeNavigationStyle.Bottom.copy(radius = 8, textSize = 16, badges = false))
        value.save(prefs)
        assertEquals(value, NativeAppearance.load(prefs))
        assertEquals(value.foldersStyle, NativeNavigationStyle.parse(prefs.getString("foldersStyle", null), NativeNavigationStyle.Folders))
    }
    @Test fun expandedGeometrySurvivesReloadForBothStyles() {
        for (defaults in listOf(NativeNavigationStyle.Folders, NativeNavigationStyle.Bottom)) {
            for (maximum in listOf(false, true)) {
                fun endpoint(range: IntRange) = if (maximum) range.last else range.first
                val style = defaults.copy(height = endpoint(NativeNavigationStyle.HeightRange),
                    radius = endpoint(NativeNavigationStyle.RadiusRange), sideInset = endpoint(NativeNavigationStyle.SideInsetRange),
                    textSize = endpoint(NativeNavigationStyle.TextSizeRange), iconSize = endpoint(NativeNavigationStyle.IconSizeRange))
                assertEquals(style, NativeNavigationStyle.parse(style.json(), defaults))
            }
        }
    }
    @Test fun oldOrCorruptPreferencesKeepCurrentStandardLook() {
        assertEquals(NativeNavigationStyle.Folders, NativeNavigationStyle.parse(null, NativeNavigationStyle.Folders))
        assertEquals(NativeNavigationStyle.Bottom, NativeNavigationStyle.parse("broken", NativeNavigationStyle.Bottom))
        assertEquals(NativeNavigationStyle.Bottom, NativeNavigationStyle.parse("{}", NativeNavigationStyle.Bottom))
    }
    @Test fun invalidRemoteValuesCannotHideEveryElementOrMakeUnboundedGeometry() {
        val value = NativeNavigationStyle.parse("""{"height":999,"radius":-1,"sideInset":999,"textSize":1,"iconSize":500,"labels":false,"icons":false,"surface":-7,"selected":4278190080} """, NativeNavigationStyle.Bottom)
        assertEquals(160, value.height); assertEquals(0, value.radius); assertEquals(80, value.sideInset)
        assertEquals(8, value.textSize); assertEquals(64, value.iconSize)
        assertFalse(value.labels); assertTrue(value.icons); assertEquals(0L, value.surface); assertEquals(0xFF000000L, value.selected)
    }
}
