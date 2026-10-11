package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeTopicLinksTest {
 @Test fun onlyConfiguredServerWithOnePositiveChatIsAccepted() {
  val base="https://volna.example"
  assertEquals(42L,nativeLinkedTopicChat("https://volna.example/app?chat=42",base))
  for(value in listOf("https://other.example/app?chat=42","http://volna.example/app?chat=42","https://evil@volna.example/app?chat=42","https://volna.example:9999/app?chat=42","https://volna.example/app?chat=-1","https://volna.example/app?chat=42&chat=43","https://volna.example/app?chat=no","https://volna.example/profile?chat=42"))assertNull(value,nativeLinkedTopicChat(value,base))
 }
 @Test fun forumStateSurvivesChatCache() {
  val chat=VolnaChat(42,"Форум","","","",0,false,0,kind="group",topicsEnabled=true)
  assertEquals(chat,NativeCodec.chats(org.json.JSONArray().put(NativeCodec.chat(chat))).single())
 }
}
