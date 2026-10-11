package dev.volna.messenger
import org.junit.Assert.*
import org.junit.Test
class NativeFormattingTest {
 @Test fun unfinishedProfileSurvivesAccountSerialization() {
  val user=VolnaUser(42,"79001112233","",firstName="Иван",lastName="Иван",profileSetupRequired=true)
  assertEquals(user,NativeCodec.user(NativeCodec.user(user)))
  val completed=user.copy(username="ivan",name="Иван Иван",profileSetupRequired=false)
  assertEquals(completed,NativeCodec.user(NativeCodec.user(completed)))
 }

 @Test fun reversedSelectionFormatsActualTextAndPreservesEmoji() {
  val emoji=NativeEmojiEntity("a".repeat(32),2,2)
  val edit=nativeFormatSelection("A 😀 B",listOf(emoji),4,2,"underline")
  assertEquals("A <u>😀</u> B",edit.text);assertEquals(5,edit.entities.single().start)
  assertEquals("A 😀 B",nativeFormatted(edit.text).text)
 }

 @Test fun allInlineFormatsAndSafeLinks() {
  val result=nativeFormatted("**жирный** __курсив__ *ещё* <u>низ</u> ~~нет~~ `x` ||секрет|| [сайт](https://example.org) [опасно](javascript:alert(1))")
  assertEquals("жирный курсив ещё низ нет x секрет сайт [опасно](javascript:alert(1))",result.text)
  assertEquals(listOf("bold","italic","italic","underline","strike","inline","spoiler","link"),result.spans.map{it.kind})
 }
 @Test fun codeIsOpaqueAndQuotesBeforeAndAfterCodeRemainQuotes() {
  val result=nativeFormatted("> цитата\n```js\nconst x = \"**text**\";\n```\n> конец")
  assertEquals("▎ цитата\nconst x = \"**text**\";\n▎ конец",result.text)
  assertEquals(2,result.spans.count{it.kind=="quote"});assertTrue(result.spans.any{it.kind=="syntax-keyword"});assertFalse(result.spans.any{it.kind=="bold"})
 }
 @Test fun unclosedFenceDoesNotLoseText() { assertEquals("```\nстрока",nativeFormatted("```\nстрока").text) }
 @Test fun customEmojiOffsetsSurviveInsertionAndRendering() {
  val emoji=NativeEmojiEntity("a".repeat(32),2,2,"b".repeat(48),"image/png")
  val edit=nativeFormatSelection("A 😀 B",listOf(emoji),2,4,"bold")
  assertEquals("A **😀** B",edit.text);assertEquals(4,edit.entities.single().start)
  val rendered=nativeFormatted(edit.text);assertEquals("A 😀 B",rendered.text);assertEquals(2,rendered.offsets[4]);assertEquals(4,rendered.offsets[6])
 }
 @Test fun codeInsertedInMiddleHasOwnLines() { assertEquals("abc\n```js\nx\n```\ndef",nativeFormatSelection("abcxdef",emptyList(),3,4,"code","js").text) }
 @Test fun unsafeLinkIsRejected() { try { nativeFormatSelection("x",emptyList(),0,1,"link","javascript:alert(1)");fail("unsafe link") }catch(_:IllegalArgumentException){} }
 @Test fun accountVisibilityDoesNotSuppressOtherAccounts() {
  assertTrue(nativeNotificationChatVisible(true,1,10,1,10));assertFalse(nativeNotificationChatVisible(true,1,10,2,10));assertFalse(nativeNotificationChatVisible(false,1,10,1,10));assertFalse(nativeNotificationChatVisible(true,1,11,1,10))
 }
 @Test fun menuFormattingAcrossLinesPreservesEmojiPosition() { val edit=nativeFormatSelection("first\n😀",listOf(NativeEmojiEntity("a".repeat(32),6,2)),0,8,"spoiler");assertEquals("||first||\n||😀||",edit.text);assertEquals(12,edit.entities[0].start);assertEquals("first\n😀",nativeFormatted(edit.text).text) }
}
