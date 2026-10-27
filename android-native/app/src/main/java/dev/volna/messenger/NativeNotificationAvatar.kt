package dev.volna.messenger

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import coil.Coil
import coil.request.SuccessResult
import kotlinx.coroutines.withTimeoutOrNull

/** Large conversation artwork contains no app badge: SystemUI adds that separately. */
internal object NativeNotificationAvatar {
    const val SIZE = 192
    private val portraits=object:android.util.LruCache<String,Bitmap>(4*1024*1024){override fun sizeOf(key:String,value:Bitmap)=value.allocationByteCount}
    private fun key(token:String,url:String):String {val account=NativeCredentials.accountId(token);val owner=if(account>0)account.toString() else "0:"+java.security.MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).take(8).joinToString(""){"%02x".format(it)};return "$owner:$url"}
    fun cached(token:String,url:String?):Bitmap?=url?.let{portraits.get(key(token,it))}
    fun removeAccount(account:Long){portraits.snapshot().keys.filter{it.startsWith("$account:")}.forEach{portraits.remove(it)}}
    fun initials(name: String, identity: Long): Bitmap {
        val colors = intArrayOf(0xff7c62ad.toInt(),0xffce7851.toInt(),0xff399c91.toInt(),0xff5b91bf.toInt(),0xffbd668d.toInt())
        val bitmap=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(bitmap);val paint=Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color=colors[Math.floorMod(identity,colors.size.toLong()).toInt()];canvas.drawCircle(SIZE/2f,SIZE/2f,SIZE/2f,paint)
        val label=name.trim().split(Regex("\\s+")).mapNotNull{word->word.firstOrNull{it.isLetterOrDigit()}}.take(2).joinToString("").uppercase().ifBlank{"?"}
        paint.color=Color.WHITE;paint.textSize=72f;paint.textAlign=Paint.Align.CENTER;paint.typeface=Typeface.create(Typeface.DEFAULT,Typeface.BOLD)
        canvas.drawText(label,SIZE/2f,SIZE/2f-(paint.ascent()+paint.descent())/2,paint)
        return bitmap
    }
    fun circular(drawable: Drawable): Bitmap {
        val source=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(source);val old=android.graphics.Rect(drawable.bounds)
        val w=drawable.intrinsicWidth.coerceAtLeast(1);val h=drawable.intrinsicHeight.coerceAtLeast(1);val scale=SIZE.toFloat()/minOf(w,h)
        val width=(w*scale).toInt();val height=(h*scale).toInt()
        try{drawable.setBounds((SIZE-width)/2,(SIZE-height)/2,(SIZE+width)/2,(SIZE+height)/2);drawable.draw(canvas)}finally{drawable.bounds=old}
        val output=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply{shader=BitmapShader(source,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP)}
        Canvas(output).drawCircle(SIZE/2f,SIZE/2f,SIZE/2f,paint);source.recycle()
        return output
    }
    suspend fun load(context: Context, token: String, url: String?): Bitmap? {
        if(url.isNullOrBlank())return null
        cached(token,url)?.let{return it}
        return withTimeoutOrNull(5_000) {
            try {
                val request=imageRequest(context,url,NativeCredentials.resolve(token)).newBuilder().size(SIZE).allowHardware(false).build()
                val result=Coil.imageLoader(context).execute(request)
                (result as? SuccessResult)?.drawable?.let(::circular)?.also{portraits.put(key(token,url),it)}
            }catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){null}
        }
    }
}
