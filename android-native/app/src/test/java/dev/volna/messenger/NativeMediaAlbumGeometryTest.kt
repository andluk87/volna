package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativeMediaAlbumGeometryTest {
    @Test fun fourPhotosUseOneLargeImageAndThreeEqualThumbnails() {
        val album = nativeAlbumGeometry(4, 320f, 2f)
        val first = album.tiles[0]
        assertEquals(0f, first.x, .01f); assertEquals(320f, first.width, .01f)
        assertTrue(first.height > album.tiles[1].height)
        val thumbs = album.tiles.drop(1)
        assertEquals(1, thumbs.map { it.y }.distinct().size)
        assertEquals(1, thumbs.map { it.width }.distinct().size)
        assertTrue(thumbs.all { it.y > first.y + first.height })
    }
    @Test fun everySupportedAlbumFitsItsBoundsWithNoOverlapsOrMissingPhotos() {
        for (count in 2..10) for (width in listOf(180f, 320f, 560f)) {
            val album = nativeAlbumGeometry(count, width, 2f)
            assertEquals((0 until count).toList(), album.tiles.map { it.index })
            for (tile in album.tiles) {
                assertTrue(tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0)
                assertTrue(tile.x + tile.width <= width + .01f)
                assertTrue(tile.y + tile.height <= album.height + .01f)
            }
            album.tiles.forEachIndexed { index, a -> album.tiles.drop(index + 1).forEach { b ->
                assertFalse("overlap for $count photos", a.x < b.x + b.width - .01f && b.x < a.x + a.width - .01f && a.y < b.y + b.height - .01f && b.y < a.y + a.height - .01f)
            } }
        }
    }
}
