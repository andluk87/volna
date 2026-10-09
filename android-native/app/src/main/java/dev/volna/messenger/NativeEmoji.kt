package dev.volna.messenger

import android.content.Context
import android.graphics.Typeface
import android.icu.text.BreakIterator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.TextUnit
import org.json.JSONObject
import java.util.Locale

internal data class NativeEmojiEntry(val text: String, val name: String, val group: String, val keywords: String, val base: String)
internal class NativeEmojiCatalog(context: Context) {
    val entries: List<NativeEmojiEntry>
    val lookup: Map<String, NativeEmojiEntry>
    private class Node { val children = HashMap<Char, Node>(); var emoji: NativeEmojiEntry? = null }
    private val root = Node()
    init {
        val data = JSONObject(context.assets.open("emoji/catalog.json").bufferedReader().use { it.readText() })
        val rows = data.getJSONArray("entries")
        entries = (0 until rows.length()).map { i -> rows.getJSONObject(i).let { NativeEmojiEntry(it.getString("text"), it.getString("name"), it.getString("group"), it.getString("keywords"), it.getString("base")) } }
        lookup = entries.associateBy { it.text }
        val canonical = entries.associateBy { it.text.replace("\uFE0F", "") }
        fun insert(value: String, emoji: NativeEmojiEntry) { var node = root; value.forEach { node = node.children.getOrPut(it) { Node() } }; node.emoji = emoji }
        entries.forEach { insert(it.text, it) }
        val aliases = data.getJSONObject("aliases")
        aliases.keys().forEach { alias -> canonical[aliases.getString(alias)]?.let { insert(alias, it) } }
    }
    fun spans(text: String): List<Pair<IntRange, NativeEmojiEntry>> {
        val result = ArrayList<Pair<IntRange, NativeEmojiEntry>>()
        var start = 0
        while (start < text.length) {
            var node = root; var cursor = start; var last: Pair<Int, NativeEmojiEntry>? = null
            while (cursor < text.length) { node = node.children[text[cursor]] ?: break; cursor++; node.emoji?.let { last = cursor to it } }
            val found = last
            if (found != null) { result += (start until found.first) to found.second; start = found.first } else start++
        }
        return result
    }
    fun variants(entry: NativeEmojiEntry): List<NativeEmojiEntry> = entries.filter { it.base == entry.base }.distinctBy { it.text }
    fun search(query: String): List<NativeEmojiEntry> {
        val words = query.lowercase(Locale.ROOT).replace('ё', 'е').trim().split(Regex("\\s+"))
        return entries.filter { e -> val text = e.keywords.replace('ё', 'е'); words.all { it in text || it == e.text } }.take(350)
    }
}

internal val LocalEmojiCatalog = staticCompositionLocalOf<NativeEmojiCatalog?> { null }
internal val LocalEmojiFont = staticCompositionLocalOf<FontFamily?> { null }

// Compose's downloadable EmojiCompat font must not replace Volna's bundled glyphs.
internal fun nativeEmojiTextStyle(style: TextStyle): TextStyle = style.copy(
    platformStyle = PlatformTextStyle(emojiSupportMatch = EmojiSupportMatch.None)
)

@Composable
internal fun NativeEmojiProvider(content: @Composable () -> Unit) {
    val context = LocalContext.current.applicationContext
    val catalog = remember(context) { NativeEmojiCatalog(context) }
    val family = remember(context) { FontFamily(Typeface.createFromAsset(context.assets, "emoji/NotoColorEmoji.ttf")) }
    CompositionLocalProvider(LocalEmojiCatalog provides catalog, LocalEmojiFont provides family, content = content)
}

internal fun emojiAnnotated(text: AnnotatedString, catalog: NativeEmojiCatalog?, font: FontFamily?): AnnotatedString {
    if (catalog == null || font == null) return text
    return AnnotatedString.Builder(text).apply { catalog.spans(text.text).forEach { (range, _) -> addStyle(SpanStyle(fontFamily = font), range.first, range.last + 1) } }.toAnnotatedString()
}

@Composable
internal fun NativeText(text: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontStyle: FontStyle? = null, fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null, letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null, textAlign: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip, softWrap: Boolean = true, maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1, onTextLayout: ((TextLayoutResult) -> Unit)? = null, style: TextStyle = LocalTextStyle.current
) = NativeText(AnnotatedString(text), modifier, color, fontSize, fontStyle, fontWeight, fontFamily,
    letterSpacing, textDecoration, textAlign, lineHeight, overflow, softWrap, maxLines, minLines, onTextLayout, style)

@Composable
internal fun NativeText(text: AnnotatedString, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontStyle: FontStyle? = null, fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null, letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null, textAlign: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip, softWrap: Boolean = true, maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1, onTextLayout: ((TextLayoutResult) -> Unit)? = null, style: TextStyle = LocalTextStyle.current
) {
    val catalog = LocalEmojiCatalog.current; val font = LocalEmojiFont.current
    val value = remember(text, catalog, font) { emojiAnnotated(text, catalog, font) }
    androidx.compose.material3.Text(value, modifier, color, fontSize, fontStyle, fontWeight, fontFamily,
        letterSpacing, textDecoration, textAlign, lineHeight, overflow, softWrap, maxLines, minLines,
        onTextLayout = onTextLayout ?: {}, style = nativeEmojiTextStyle(style))
}

internal class NativeEmojiTransformation(private val catalog: NativeEmojiCatalog?, private val font: FontFamily?) : VisualTransformation {
    override fun filter(text: AnnotatedString) = TransformedText(emojiAnnotated(text, catalog, font), OffsetMapping.Identity)
}

internal object NativeEmojiEditing {
    fun insert(value: TextFieldValue, text: String): TextFieldValue {
        val start = value.selection.min; val end = value.selection.max
        return TextFieldValue(value.text.replaceRange(start, end, text), TextRange(start + text.length))
    }
    fun delete(value: TextFieldValue, catalog: NativeEmojiCatalog? = null): TextFieldValue =
        delete(value, catalog?.spans(value.text)?.map { it.first }.orEmpty())

    internal fun delete(value: TextFieldValue, spans: List<IntRange>): TextFieldValue {
        var start = value.selection.min
        var end = value.selection.max
        if (value.selection.collapsed && end <= 0) return value
        // Longest catalog sequence protects ZWJ families and mixed skin tones even on old Android ICU.
        if (value.selection.collapsed) {
            val emoji = spans.lastOrNull { it.first < end && it.last + 1 >= end }
            if (emoji != null) { start = emoji.first; end = emoji.last + 1 }
            else {
                val iterator = BreakIterator.getCharacterInstance(Locale.ROOT).apply { setText(value.text) }
                start = iterator.preceding(end).coerceAtLeast(0)
                end = iterator.following(start).coerceIn(end, value.text.length)
            }
        } else {
            // A selection made by the IME may end inside a surrogate or ZWJ sequence.
            spans.filter { it.first < end && it.last + 1 > start }.forEach { start = minOf(start, it.first); end = maxOf(end, it.last + 1) }
        }
        return TextFieldValue(value.text.removeRange(start, end), TextRange(start))
    }
    fun adjustEntities(before: String, after: String, entities: List<NativeEmojiEntity>): List<NativeEmojiEntity> {
        if (before == after) return entities
        var prefix = 0
        while (prefix < before.length && prefix < after.length && before[prefix] == after[prefix]) prefix++
        var suffix = 0
        while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.lastIndex - suffix] == after[after.lastIndex - suffix]) suffix++
        val removedEnd = before.length - suffix; val delta = after.length - before.length
        return entities.mapNotNull { e -> when { e.start + e.length <= prefix -> e; e.start >= removedEnd -> e.copy(start = e.start + delta); else -> null } }
    }
}

data class NativeEmojiEntity(val id: String, val start: Int, val length: Int, val attachmentId: String = "", val mime: String = "image/webp") {
    fun json() = JSONObject().put("id", id).put("start", start).put("length", length).put("attachment_id", attachmentId).put("mime", mime)
    companion object {
        fun parse(row: JSONObject) = NativeEmojiEntity(row.optString("id"), row.optInt("start"), row.optInt("length"), row.optString("attachment_id"), row.optString("mime", "image/webp"))
    }
}
