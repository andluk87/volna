package dev.volna.messenger

import android.app.Application
import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeWatchIconTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun draw(drawable: Drawable): Bitmap {
        val bitmap = Bitmap.createBitmap(108, 108, Bitmap.Config.ARGB_8888)
        drawable.setBounds(0, 0, 108, 108)
        drawable.draw(Canvas(bitmap))
        return bitmap
    }
    @Test fun companionAppsCanDecodeTheExportedApplicationAndLauncherIconsAsPng() {
        val pm = context.packageManager
        val app = pm.getApplicationInfo(context.packageName, 0)
        val activity = pm.getActivityInfo(ComponentName(context, MainActivity::class.java), 0)
        assertEquals(R.drawable.volna_launcher, app.icon)
        assertEquals(app.icon, activity.icon)
        // Robolectric getApplicationIcon is a registered-icon map, not the platform loader.
        // Decode the actual exported resource through Android Resources instead.
        val resources = pm.getResourcesForApplication(app)
        assertTrue(resources.getDrawable(app.icon, null) is BitmapDrawable)
        assertTrue(resources.getDrawable(activity.icon, null) is BitmapDrawable)
        val bitmap = BitmapFactory.decodeResource(context.resources, app.icon)
        assertNotNull(bitmap)
        assertEquals(512, bitmap.width)
        assertEquals(512, bitmap.height)
        assertTrue(Color.alpha(bitmap.getPixel(256, 256)) > 240)
        var blue = 0
        for (y in 0 until bitmap.height step 8) for (x in 0 until bitmap.width step 8) {
            val pixel = bitmap.getPixel(x,y)
            if (Color.alpha(pixel) > 200 && Color.blue(pixel) > Color.red(pixel) + 40) blue++
        }
        assertTrue("The exported bitmap must contain the colored logo", blue > 100)
    }
    @Test fun adaptiveResourcesAlsoHaveAVisibleForegroundInsteadOfAnEmptyLayer() {
        val icon = context.getDrawable(R.mipmap.ic_launcher) as AdaptiveIconDrawable
        val bitmap = draw(icon.foreground)
        assertTrue("A companion extracting only the foreground must get visible pixels", (0 until 108).any { x -> (0 until 108).any { y -> Color.alpha(bitmap.getPixel(x,y)) > 200 } })
    }
    @Test fun notificationSmallIconRemainsAMonochromeMaskAndCanBeForwarded() {
        val notification = nativeNotificationBuilder(context, "watch-test", includeArtwork = false).build()
        assertEquals(R.drawable.ic_volna_notification, notification.smallIcon.resId)
        assertEquals(0, notification.flags and android.app.Notification.FLAG_LOCAL_ONLY)
        val mask = BitmapFactory.decodeResource(context.resources, notification.smallIcon.resId)
        assertEquals(0, Color.alpha(mask.getPixel(0,0)))
        var visible = 0
        for (y in 0 until mask.height) for (x in 0 until mask.width) {
            val pixel = mask.getPixel(x,y)
            if (Color.alpha(pixel) > 0) {
                visible++
                assertEquals(255, Color.red(pixel)); assertEquals(255, Color.green(pixel)); assertEquals(255, Color.blue(pixel))
            }
        }
        assertTrue(visible > 0)
    }
}
