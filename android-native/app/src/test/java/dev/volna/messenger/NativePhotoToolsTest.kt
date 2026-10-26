package dev.volna.messenger
import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.geometry.Offset
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativePhotoToolsTest {
    @Test fun drawingChangesCopyAndKeepsOriginalPixels() {
        val original = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
        val edited = renderPhoto(original, listOf(PhotoStroke(Color.RED, .1f, listOf(Offset(.1f,.5f),Offset(.9f,.5f)))))
        assertEquals(Color.RED, edited.getPixel(50,50)); assertEquals(Color.WHITE, original.getPixel(50,50)); assertEquals(Color.WHITE, edited.getPixel(50,10))
        val undone = renderPhoto(original, emptyList()); assertEquals(Color.WHITE, undone.getPixel(50,50))
        original.recycle(); edited.recycle(); undone.recycle()
    }
}
