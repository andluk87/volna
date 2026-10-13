package dev.volna.messenger

import android.app.Notification
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader

/** Supply both Android's monochrome mask and the colour artwork to notification listeners. */
internal fun nativeNotificationBuilder(context:Context,channel:String):Notification.Builder =
 Notification.Builder(context,channel).setSmallIcon(R.drawable.ic_volna_notification)
  .setLargeIcon(NativeNotificationArtwork.round(context)).setColor(0xff38a8d6.toInt()).setLocalOnly(false)

internal object NativeNotificationArtwork {
 private var cached:Bitmap?=null
 @Synchronized fun round(context:Context):Bitmap {
  cached?.let{return it}
  val source=BitmapFactory.decodeResource(context.resources,R.drawable.volna_launcher)
  val scaled=Bitmap.createScaledBitmap(source,192,192,true)
  val output=Bitmap.createBitmap(192,192,Bitmap.Config.ARGB_8888)
  val paint=Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply{shader=BitmapShader(scaled,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP)}
  Canvas(output).drawCircle(96f,96f,96f,paint)
  if(scaled!==source)scaled.recycle()
  source.recycle()
  cached=output
  return output
 }
}
