@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package dev.volna.messenger

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*
import kotlin.math.roundToInt

// Image overlays share the editable text's coordinates and scroll container. The
// underlying Unicode stays intact for cursor movement, selection, copy and IME.
@Composable
internal fun NativeRichComposer(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    entities: List<NativeEmojiEntity>,
    account: Long,
    token: String,
    api: NativeApi,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    maxLines: Int = 6
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val catalog = LocalEmojiCatalog.current
    val font = LocalEmojiFont.current
    val store = remember(account) { NativeExpressionStore(context, account) }
    val interaction = remember { MutableInteractionSource() }
    val scroll = rememberScrollState()
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val valid = remember(entities, value.text) {
        entities.filter { it.start >= 0 && it.length > 0 && it.start + it.length <= value.text.length && it.attachmentId.matches(Regex("[a-f0-9]{48}")) }
    }
    val transformation = remember(catalog, font, valid) {
        VisualTransformation { original ->
            val annotated = emojiAnnotated(original, catalog, font)
            val result = AnnotatedString.Builder(annotated).apply {
                valid.forEach { addStyle(SpanStyle(color = Color.Transparent), it.start, it.start + it.length) }
            }.toAnnotatedString()
            TransformedText(result, OffsetMapping.Identity)
        }
    }
    val style = nativeEmojiTextStyle(LocalTextStyle.current.copy(color = TextMain, fontSize = 16.sp, lineHeight = 22.sp))
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Color.Transparent, unfocusedBorderColor = Color.Transparent,
        focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
        focusedTextColor = TextMain, unfocusedTextColor = TextMain, cursorColor = Accent
    )
    val textHeight = with(density) { 22.sp.toDp() } * maxLines.coerceIn(1, 6)
    LaunchedEffect(value.selection, layout, scroll.viewportSize) {
        val current = layout ?: return@LaunchedEffect
        if (current.layoutInput.text.text != value.text || scroll.viewportSize <= 0) return@LaunchedEffect
        val cursor = current.getCursorRect(value.selection.end.coerceIn(0, value.text.length))
        val next = when {
            cursor.top < scroll.value -> cursor.top.roundToInt()
            cursor.bottom > scroll.value + scroll.viewportSize -> (cursor.bottom - scroll.viewportSize).roundToInt()
            else -> scroll.value
        }
        scroll.scrollTo(next.coerceIn(0, scroll.maxValue))
    }
    BasicTextField(
        value = value, onValueChange = onValueChange, enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp), textStyle = style,
        cursorBrush = SolidColor(Accent), visualTransformation = transformation,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
        interactionSource = interaction, minLines = 1, maxLines = Int.MAX_VALUE,
        onTextLayout = { layout = it },
        decorationBox = { inner ->
            OutlinedTextFieldDefaults.DecorationBox(
                value = value.text, enabled = enabled, singleLine = false,
                visualTransformation = transformation, interactionSource = interaction,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp), colors = fieldColors,
                container = {
                    OutlinedTextFieldDefaults.ContainerBox(
                        enabled = enabled, isError = false, interactionSource = interaction,
                        colors = fieldColors, shape = RoundedCornerShape(24.dp)
                    )
                },
                placeholder = { NativeText("Сообщение", color = Muted, fontSize = 15.sp) },
                innerTextField = {
                    Box(Modifier.heightIn(max = textHeight).verticalScroll(scroll).clipToBounds()) {
                        inner()
                        val current = layout
                        if (current != null && current.layoutInput.text.text == value.text) valid.forEach { entity ->
                            val bounds = nativeComposerEmojiBounds(current, entity)
                            val item = NativeExpression(entity.id, "", "emoji", "Пользовательский эмодзи", emptyList(),
                                value.text.substring(entity.start, entity.start + entity.length), entity.attachmentId, entity.mime, 0, "")
                            NativeExpressionImage(item, token, api, store,
                                Modifier.offset { IntOffset(bounds.left.roundToInt(), bounds.top.roundToInt()) }
                                    .size(with(density) { bounds.width.coerceAtLeast(1f).toDp() }, with(density) { bounds.height.coerceAtLeast(1f).toDp() }),
                                play = bounds.bottom >= scroll.value && bounds.top <= scroll.value + scroll.viewportSize)
                        }
                    }
                }
            )
        }
    )
}

private fun nativeComposerEmojiBounds(layout: TextLayoutResult, entity: NativeEmojiEntity): Rect {
    var result = layout.getBoundingBox(entity.start)
    val line = layout.getLineForOffset(entity.start)
    for (offset in entity.start + 1 until entity.start + entity.length) {
        if (layout.getLineForOffset(offset) != line) break
        val box = layout.getBoundingBox(offset)
        result = Rect(minOf(result.left, box.left), minOf(result.top, box.top), maxOf(result.right, box.right), maxOf(result.bottom, box.bottom))
    }
    return result
}
