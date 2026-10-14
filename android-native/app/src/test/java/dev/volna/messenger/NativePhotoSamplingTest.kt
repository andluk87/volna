package dev.volna.messenger

import org.junit.Assert.assertEquals
import org.junit.Test

class NativePhotoSamplingTest {
    @Test fun smallPhotoAndExactLimitDoNotDivideByZeroOrUpscale() {
        assertEquals(1, nativePhotoSampleSize(640, 480, 1024))
        assertEquals(1, nativePhotoSampleSize(1024, 768, 1024))
    }
    @Test fun cameraPhotoIsBoundedInPortraitAndLandscape() {
        assertEquals(4, nativePhotoSampleSize(4032, 3024, 1024))
        assertEquals(4, nativePhotoSampleSize(3024, 4032, 1024))
        assertEquals(8, nativePhotoSampleSize(8000, 6000, 1600))
    }
    @Test(expected = IllegalArgumentException::class) fun corruptDimensionsAreRejected() {
        nativePhotoSampleSize(-1, 0, 1024)
    }
}
