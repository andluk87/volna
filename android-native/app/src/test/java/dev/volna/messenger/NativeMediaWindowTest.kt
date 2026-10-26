package dev.volna.messenger
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
class NativeMediaWindowTest {
 private fun message(id: Long, chat: Long = 1, mime: String = "image/png")=VolnaMessage(id,1,"Автор","Подпись $id","2026-10-26T12:00:00Z",false,"$id.png",attachmentId=id.toString().padStart(48,'a'),attachmentMime=mime,chatId=chat)
 @Test fun aroundReplacesSparseSeedsAndCursorPagesKeepCurrentIdAndBothMediaTypes()=runBlocking {
  val calls=mutableListOf<Pair<String,String?>>()
  val repo=NativeMediaWindow(message(85),listOf(message(1),message(85),message(200),message(300,2)),"test",NativeApi("https://example.invalid")){direction,cursor->
   calls.add(direction to cursor)
   when(direction){"around"->NativeMediaPage(listOf(message(84),message(85),message(86,mime="video/mp4")),"left","right",true,true);"before"->NativeMediaPage(listOf(message(82),message(83),message(84)),null,"unused",false,true);else->NativeMediaPage(listOf(message(86,mime="video/mp4"),message(87)),"unused",null,true,false)}
  }
  repo.load();assertEquals(listOf(84L,85L,86L),repo.items.map{it.id});assertEquals(85L,repo.current!!.id)
  repo.load("before");repo.load("after");assertEquals(listOf(82L,83L,84L,85L,86L,87L),repo.items.map{it.id});assertEquals(85L,repo.current!!.id);assertTrue(repo.complete);assertEquals(listOf("around" to null,"before" to "left","after" to "right"),calls)
  repo.remove(85);assertEquals(86L,repo.current!!.id);repo.update(message(86).copy(deleted=true));assertEquals(87L,repo.current!!.id)
 }
 @Test fun lostAccessClearsLoadedMediaAndOfflineKeepsTheSeed()=runBlocking {
  val denied=NativeMediaWindow(message(2),emptyList(),"test",NativeApi("https://example.invalid")){_,_->throw NativeApiException(403,"Denied")};denied.load();assertTrue(denied.denied);assertTrue(denied.items.isEmpty())
  val offline=NativeMediaWindow(message(2),listOf(message(1)),"test",NativeApi("https://example.invalid")){_,_->throw java.io.IOException("Offline")};offline.load();assertFalse(offline.denied);assertEquals(2,offline.items.size);assertEquals(2L,offline.current!!.id)
 }
 @Test fun panBoundsPreventPortraitImagesFromBeingDraggedIntoBlankSpace() {
  assertEquals(0f,nativePanLimit(400f,800f,.25f,2f).x,.01f);assertEquals(400f,nativePanLimit(400f,800f,.25f,2f).y,.01f)
 }
}
