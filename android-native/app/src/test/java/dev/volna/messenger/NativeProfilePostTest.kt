package dev.volna.messenger
import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
class NativeProfilePostTest {
 @Test fun mediaAndArchiveMetadataAreParsedWithoutMessageIds(){
  val row=JSONObject().put("id",4).put("user_id",7).put("text","Подпись").put("created",1000).put("archived",1).put("attachment",JSONObject().put("id","a".repeat(48)).put("name","video.mp4").put("mime","video/mp4").put("size",123))
  val post=NativeApi("https://example.invalid").parseProfilePost(row)
  assertEquals(4,post.id.toInt());assertTrue(post.archived);assertEquals("video/mp4",post.mime);assertEquals(123,post.size.toInt())
 }
 @Test fun uploadReadIsBoundedOnOlderAndroidApis(){
  assertArrayEquals(byteArrayOf(1,2,3),nativePostBytes(byteArrayOf(1,2,3).inputStream(),3))
  try{nativePostBytes(ByteArray(4).inputStream(),3);fail("oversized file must be rejected")}catch(expected:IllegalArgumentException){assertTrue(expected.message!!.contains("20 МБ"))}
 }
 @Test fun videoPreviewUsesTheConfiguredFileProviderDirectory(){
  val context=org.robolectric.RuntimeEnvironment.getApplication()
  val file=nativePostTemporaryFile(context,"video/webm")
  try{val uri=androidx.core.content.FileProvider.getUriForFile(context,"${context.packageName}.fileprovider",file);assertEquals("content",uri.scheme);assertTrue(uri.path!!.contains("attachments"));assertTrue(file.name.endsWith(".webm"))}finally{file.delete()}
 }

}
