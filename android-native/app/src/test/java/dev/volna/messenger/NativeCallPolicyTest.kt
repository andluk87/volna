package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeCallPolicyTest {
    @Test fun screenMayTurnOffOnlyDuringConnectedEarpieceCalls() {
        assertTrue(nativeCallUsesProximity(true, true, false, false))
        assertFalse(nativeCallUsesProximity(false, true, false, false))
        assertFalse(nativeCallUsesProximity(true, false, false, false))
    }
    @Test fun videoAndScreenSharingKeepControlsVisible() {
        assertFalse(nativeCallUsesProximity(true, true, true, false))
        assertFalse(nativeCallUsesProximity(true, true, false, true))
    }
    @Test fun videoPreviewRemainsInsideScreenAfterDragging() {
        assertEquals(0f, nativePreviewCoordinate(-50f, 200f), 0f)
        assertEquals(200f, nativePreviewCoordinate(500f, 200f), 0f)
        assertEquals(120f, nativePreviewCoordinate(120f, 200f), 0f)
    }
    @Test fun videoPreviewAdaptsToSmallerAndCollapsedViewport() {
        assertEquals(80f, nativePreviewCoordinate(200f, 80f), 0f)
        assertEquals(0f, nativePreviewCoordinate(200f, 0f), 0f)
    }
}
