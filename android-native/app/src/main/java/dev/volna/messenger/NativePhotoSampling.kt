package dev.volna.messenger

/** BitmapFactory.Options starts at zero; a decode sample must start at one. */
internal fun nativePhotoSampleSize(width: Int, height: Int, maxEdge: Int): Int {
    require(width > 0 && height > 0 && maxEdge > 0)
    var sample = 1
    while (maxOf(width, height) / sample > maxEdge) sample *= 2
    return sample
}
