package dev.volna.messenger

internal data class NativeFormatSpan(val start: Int, val end: Int, val kind: String, val url: String = "")
internal data class NativeFormatted(val text: String, val spans: List<NativeFormatSpan>, val offsets: IntArray)
internal val nativeFormatOptions = listOf("bold" to "Жирный", "italic" to "Курсив", "underline" to "Подчёркнутый", "strike" to "Зачёркнутый", "inline" to "Моноширинный", "code" to "Блок кода", "spoiler" to "Спойлер", "quote" to "Цитата", "link" to "Гиперссылка")
private val nativeInlinePattern = Regex("""<u>[^\n]+?</u>|\|\|[^\n]+?\|\||__[^_\n]+__|\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|`[^`\n]+`|\[[^\]\n]+\]\(https?://[^)\s]+\)""")
internal fun nativeFormatted(source: String): NativeFormatted {
    val out = StringBuilder(); val spans = mutableListOf<NativeFormatSpan>(); val offsets = IntArray(source.length + 1) { -1 }
    fun literal(a: Int, b: Int) { for (i in a until b) { offsets[i] = out.length; out.append(source[i]) }; offsets[b] = out.length }
    fun inline(a: Int, b: Int, depth: Int = 0) {
        if (depth >= 8) { literal(a, b); return }
        var cursor = a
        nativeInlinePattern.findAll(source.substring(a,b)).forEach { match ->
            val start = a + match.range.first; val end = a + match.range.last + 1; literal(cursor, start)
            val raw = match.value
            val (kind, left, right) = when {
                raw.startsWith("<u>") -> Triple("underline",3,4)
                raw.startsWith("||") -> Triple("spoiler",2,2)
                raw.startsWith("__") -> Triple("italic",2,2)
                raw.startsWith("**") -> Triple("bold",2,2)
                raw.startsWith("~~") -> Triple("strike",2,2)
                raw.startsWith("`") -> Triple("inline",1,1)
                raw.startsWith("[") -> Triple("link",1,raw.length - raw.indexOf("]("))
                else -> Triple("italic",1,1)
            }
            val renderedStart = out.length
            if (kind == "inline") literal(start+left,end-right) else inline(start+left,end-right,depth+1)
            spans.add(NativeFormatSpan(renderedStart,out.length,kind,if(kind=="link") raw.substring(raw.indexOf("](")+2,raw.length-1) else ""))
            cursor = end
        }; literal(cursor,b)
    }
    // Quote markers are stripped only outside fenced code.
    fun tail(a: Int,b: Int) {
        var at=a
        while(at<b) { val end=source.indexOf('\n',at).let { if(it<0||it>b)b else it }; if(source.startsWith(">",at)){val start=out.length;out.append("▎ ");val skip=if(source.getOrNull(at+1)==' ')2 else 1;inline((at+skip).coerceAtMost(end),end);spans.add(NativeFormatSpan(start,out.length,"quote"))}else inline(at,end);if(end<b)literal(end,end+1);at=end+1 }
    }
    var cursor = 0
    val fence = Regex("(?m)^```([\\w+#.-]{0,20})[ \\t]*$")
    while (cursor < source.length) {
        val open = fence.find(source,cursor)
        if (open == null) { break }
        val close = fence.find(source,open.range.last+1)
        if (close == null) { break }
        tail(cursor,open.range.first)
        val start = out.length
        val a = (open.range.last+2).coerceAtMost(source.length)
        val b = (close.range.first-1).coerceAtLeast(a)
        literal(a,b); spans.add(NativeFormatSpan(start,out.length,"code"))
        nativeHighlight(source.substring(a,b),open.groupValues[1]).forEach { spans.add(it.copy(start=it.start+start,end=it.end+start)) }
        if (close.range.last+1 < source.length) out.append('\n')
        cursor = (close.range.last+2).coerceAtMost(source.length)
    }
    tail(cursor,source.length);offsets[source.length]=out.length
    return NativeFormatted(out.toString(),spans,offsets)
}
internal fun nativeHighlight(text: String, language: String): List<NativeFormatSpan> {
    val lang=language.lowercase(); if(lang !in setOf("js","javascript","jsx","ts","typescript","tsx","json","py","python","sql","sh","bash","shell","css","html","xml","java","kotlin","kt","c","cpp","go","rust","rb","ruby"))return emptyList()
    val words="const let var function return if else for while class new import export from async await true false null undefined try catch throw def print in and or not None True False lambda with as select from where join insert into update delete create table values set order by limit public private fun val when object interface package void int boolean string extends implements static this yield switch case break continue do".split(' ').toSet()
    val tokens=Regex("""/\*[\s\S]*?\*/|//[^\n]*|#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b""")
    return tokens.findAll(text).mapNotNull { m -> val v=m.value;val type=when {v.startsWith("//")||v.startsWith("/*")||lang in setOf("py","python","sh","bash","shell","rb","ruby")&&v.startsWith("#")||lang=="sql"&&v.startsWith("--")->"comment";v.first() in "\"'`"->"string";v.first().isDigit()->"number";words.contains(if(lang=="sql")v.lowercase() else v)->"keyword";else->null};type?.let { NativeFormatSpan(m.range.first,m.range.last+1,"syntax-$it") } }.toList()
}
internal data class NativeFormatEdit(val text: String, val entities: List<NativeEmojiEntity>, val start: Int, val end: Int)
internal fun nativeFormatSelection(value: String, entities: List<NativeEmojiEntity>, a: Int, b: Int, kind: String, option: String = ""): NativeFormatEdit {
    val start=a.coerceIn(0,value.length);val end=b.coerceIn(start,value.length);val selected=value.substring(start,end).ifEmpty{"текст"};var content=selected
    val pair=when(kind){
        "quote" -> {content=selected.split('\n').joinToString("\n"){"> $it"};(if(start==0||value[start-1]=='\n')"" else "\n") to ""}
        "link" -> { val uri=try{java.net.URI(option)}catch(_:Exception){throw IllegalArgumentException("Введите полный адрес https://example.org")};require(uri.scheme in listOf("http","https")&&!uri.host.isNullOrBlank()&&uri.userInfo==null){"Ссылка должна начинаться с http:// или https://"};"[" to ("]("+option.replace("(","%28").replace(")","%29")+")") }
        "code" -> {require(Regex("[\\w+#.-]{0,20}").matches(option)){"Укажите язык кода, например js или python"};((if(start==0||value[start-1]=='\n')"" else "\n")+"```$option\n") to ("\n```"+(if(end==value.length||value[end]=='\n')"" else "\n"))}
        "bold"->"**" to "**";"italic"->"__" to "__";"underline"->"<u>" to "</u>";"strike"->"~~" to "~~";"inline"->"`" to "`";"spoiler"->"||" to "||";else->throw IllegalArgumentException("Неизвестный формат")
    }
    val multiline=kind !in listOf("quote","code") && content.contains('\n');if(multiline)content=content.split('\n').joinToString(pair.second+"\n"+pair.first)
    val text=value.substring(0,start)+pair.first+content+pair.second+value.substring(end);require(text.length<=4000){"Форматирование превышает лимит сообщения"}
    val mapped=entities.map { e -> when {e.start>=end->e.copy(start=e.start+text.length-value.length);e.start<start->e;else->e.copy(start=e.start+pair.first.length+(if(kind=="quote")2+2*value.substring(start,e.start).count{it=='\n'} else if(multiline)(pair.first.length+pair.second.length)*value.substring(start,e.start).count{it=='\n'} else 0))} }
    return NativeFormatEdit(text,mapped,start+pair.first.length,start+pair.first.length+content.length)
}
