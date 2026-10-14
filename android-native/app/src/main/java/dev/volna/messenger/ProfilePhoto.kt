package dev.volna.messenger

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream

/** Decode a bounded image, respecting EXIF on every supported Android version, before uploading it. */
internal fun profilePhoto(context: Context, uri: Uri, maxEdge: Int = 1024, quality: Int = 90): ByteArray {
    require(maxEdge > 0 && quality in 0..100)
    val bitmap = if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            require(info.size.width.toLong() * info.size.height <= 100_000_000) { "Фото слишком большое" }
            val scale = (maxEdge.toFloat() / maxOf(info.size.width, info.size.height)).coerceAtMost(1f)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
        }
    } else {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 100_000_000) { "Не удалось прочитать фото" }
        options.inJustDecodeBounds = false
        options.inSampleSize = nativePhotoSampleSize(options.outWidth, options.outHeight, maxEdge)
        val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: error("Не удалось прочитать фото")
        try {
            val exif = context.contentResolver.openInputStream(uri)?.use { ExifInterface(it) }
            val matrix = Matrix().apply {
                if (exif?.isFlipped == true) postScale(-1f, 1f)
                postRotate(exif?.rotationDegrees?.toFloat() ?: 0f)
            }
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also {
                if (it !== decoded) decoded.recycle()
            }
        } catch (problem: Exception) { decoded.recycle(); throw problem }
    }
    val jpeg = if (bitmap.hasAlpha()) Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888).also {
        Canvas(it).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
    } else bitmap
    return try { ByteArrayOutputStream().use { output ->
        check(jpeg.compress(Bitmap.CompressFormat.JPEG, quality, output)) { "Не удалось подготовить фото" }
        output.toByteArray().also { require(it.size <= 5 * 1024 * 1024) { "Фото превышает 5 МБ" } }
    } } finally { if (jpeg !== bitmap) jpeg.recycle(); bitmap.recycle() }
}
