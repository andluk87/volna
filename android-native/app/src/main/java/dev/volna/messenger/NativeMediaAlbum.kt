package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

internal data class NativeAlbumTile(val index: Int, val x: Float, val y: Float, val width: Float, val height: Float)
internal data class NativeAlbumGeometry(val width: Float, val height: Float, val tiles: List<NativeAlbumTile>)

/** Stable Telegram-style rows; one leading image and three thumbnails for four photos. */
internal fun nativeAlbumGeometry(count: Int, width: Float, gap: Float): NativeAlbumGeometry {
    require(count in 2..10 && width > 0 && gap >= 0 && gap * 2 < width)
    val rows = when (count) {
        2 -> listOf(2)
        3 -> listOf(1, 2)
        4 -> listOf(1, 3)
        5 -> listOf(2, 3)
        6 -> listOf(3, 3)
        7 -> listOf(3, 2, 2)
        8 -> listOf(3, 3, 2)
        9 -> listOf(3, 3, 3)
        else -> listOf(3, 3, 2, 2)
    }
    val tiles = mutableListOf<NativeAlbumTile>()
    var top = 0f
    rows.forEachIndexed { row, columns ->
        val height = width * when {
            rows.size == 1 -> .62f
            columns == 1 -> .72f
            count <= 4 -> .42f
            rows.size == 2 -> .40f
            else -> .32f
        }
        val cellWidth = (width - gap * (columns - 1)) / columns
        repeat(columns) { column -> tiles += NativeAlbumTile(tiles.size, column * (cellWidth + gap), top, cellWidth, height) }
        top += height + if (row == rows.lastIndex) 0f else gap
    }
    return NativeAlbumGeometry(width, top, tiles)
}

@Composable
internal fun NativeMediaAlbum(messages: List<VolnaMessage>, token: String, onOpen: (VolnaMessage) -> Unit,
    onLong: (VolnaMessage) -> Unit, modifier: Modifier = Modifier) {
    Layout(modifier = modifier, content = {
        messages.forEach { photo ->
            AttachmentThumbnail(photo, token, { onOpen(photo) }, Modifier.testTag("album-item-${photo.id}"),
                onLongPress = { onLong(photo) }, seamless = true)
        }
    }) { nodes, constraints ->
        val geometry = nativeAlbumGeometry(nodes.size, constraints.maxWidth.toFloat(), 2.dp.toPx())
        val children = nodes.mapIndexed { index, node ->
            val tile = geometry.tiles[index]
            val left = tile.x.roundToInt(); val top = tile.y.roundToInt()
            val right = (tile.x + tile.width).roundToInt(); val bottom = (tile.y + tile.height).roundToInt()
            node.measure(Constraints.fixed(right - left, bottom - top))
        }
        layout(constraints.maxWidth, geometry.height.roundToInt()) {
            children.forEachIndexed { index, child ->
                val tile = geometry.tiles[index]
                child.place(tile.x.roundToInt(), tile.y.roundToInt())
            }
        }
    }
}
