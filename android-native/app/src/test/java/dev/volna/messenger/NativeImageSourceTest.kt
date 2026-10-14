package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeImageSourceTest {
    private val base = "https://volna.example"
    private val file = "/api/files/" + "a".repeat(48)
    @Test fun relativePhotosUseApiOrigin() {
        assertEquals(NativeImageSource(base + file, true), nativeImageSource(base, file))
    }
    @Test fun absolutePhotosAndQueriesKeepAuthentication() {
        assertTrue(nativeImageSource(base, "$base$file?v=2").authenticated)
        assertTrue(nativeImageSource(base, "https://volna.example:443$file").authenticated)
    }
    @Test fun serverIconsResolveWithoutCredentials() {
        assertEquals(NativeImageSource("$base/icons/icon-192.png", false), nativeImageSource(base, "/icons/icon-192.png"))
    }
    @Test fun credentialsNeverGoToOtherOrigins() {
        listOf("https://other.example$file", "//other.example$file", "http://volna.example$file", "https://volna.example:8443$file", "https://user@volna.example$file").forEach {
            assertFalse(it, nativeImageSource(base, it).authenticated)
        }
    }
    @Test fun localPreviewsRemainLocal() {
        assertEquals(NativeImageSource("content://media/external/images/7", false), nativeImageSource(base, "content://media/external/images/7"))
        assertFalse(nativeImageSource(base, "file:///tmp/photo.jpg").authenticated)
    }
}
