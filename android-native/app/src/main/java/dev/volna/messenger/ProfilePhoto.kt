package dev.volna.messenger

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream

/** Decode a bounded image, respecting EXIF on modern Android, before uploading it. */
internal fun profilePhoto(context: Context, uri: Uri, maxEdge: Int = 1024, quality: Int = 90): ByteArray {
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
        while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > maxEdge) options.inSampleSize *= 2
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: error("Не удалось прочитать фото")
    }
    val jpeg = if (bitmap.hasAlpha()) Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888).also {
        Canvas(it).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
    } else bitmap
    return try { ByteArrayOutputStream().use { output ->
        check(jpeg.compress(Bitmap.CompressFormat.JPEG, quality, output)) { "Не удалось подготовить фото" }
        output.toByteArray().also { require(it.size <= 5 * 1024 * 1024) { "Фото превышает 5 МБ" } }
    } } finally { if (jpeg !== bitmap) jpeg.recycle(); bitmap.recycle() }
}
