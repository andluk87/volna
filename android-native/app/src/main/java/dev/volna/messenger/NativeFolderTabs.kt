package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Share the entire viewport equally while every tab still fits. Distribute the
// remainder too: dividing 361 px into three tabs must not leave a blank pixel.
// Otherwise every scrollable tab keeps the width required by the longest title,
// so the row never leaves unused space or mixes narrow and wide segments.
internal fun nativeFolderTabWidths(viewportWidth: Int, naturalWidths: List<Int>): List<Int> {
    if (naturalWidths.isEmpty()) return emptyList()
    val equalWidths = List(naturalWidths.size) { index ->
        viewportWidth / naturalWidths.size + if (index < viewportWidth % naturalWidths.size) 1 else 0
    }
    return if (naturalWidths.indices.all { naturalWidths[it] <= equalWidths[it] }) equalWidths
        else List(naturalWidths.size) { naturalWidths.max() }
}

@Composable
internal fun NativeFolderTabs(
    folders: List<NativeFolder>, chats: List<VolnaChat>, selected: String, onSelect: (String) -> Unit
) {
    val tabs = nativeNavigationFolders(folders, chats)
    if (tabs.isEmpty()) return
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp).clip(RoundedCornerShape(28.dp)).background(Hover.copy(alpha = .55f)).padding(4.dp)) {
        val viewportWidth = with(density) { maxWidth.roundToPx() }
        Layout(
            modifier = Modifier.fillMaxWidth().horizontalScroll(scroll),
            content = {
                tabs.forEach { folder -> key(folder.id) {
                    val folderKey = if (folder.rule == "all") "all" else "folder:${folder.id}"
                    val active = selected == folderKey || folder.rule == "all" && selected == "all"
                    val unread = chats.count { (it.unread > 0 || it.manualUnread) && (if (folder.rule == "all") nativeUnassignedChat(it, tabs) && nativeChatFilter(it, "all") else nativeFolderMatches(folder, it)) }
                    Row(
                        Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).clip(CircleShape)
                            .background(if (active) Accent.copy(alpha = .16f) else Color.Transparent)
                            .selectable(selected = active, role = Role.Tab, onClick = { onSelect(folderKey) })
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center
                    ) {
                        NativeText(
                            folder.icon + folder.name,
                            modifier = Modifier.weight(1f, fill = false),
                            color = if (active) Accent else folder.color.takeIf { it in nativeFolderColors }
                                ?.let { Color(android.graphics.Color.parseColor(it)) } ?: if (active) Accent else Muted,
                            fontSize = 14.sp, fontWeight = FontWeight.Medium,
                            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis
                        )
                        NativeUnreadBadge(
                            unread, Modifier.padding(start = 5.dp),
                            containerColor = if (active) Accent else Muted, contentColor = Panel,
                            countDescription = "Непрочитанных чатов"
                        )
                    }
                } }
            }
        ) { measurables, constraints ->
            val naturalWidths = measurables.map {
                it.maxIntrinsicWidth(Constraints.Infinity).coerceAtMost(viewportWidth)
            }
            val widths = nativeFolderTabWidths(viewportWidth, naturalWidths)
            val tabs = measurables.mapIndexed { index, tab ->
                tab.measure(Constraints(minWidth = widths[index], maxWidth = widths[index], maxHeight = constraints.maxHeight))
            }
            layout(widths.sum(), tabs.maxOfOrNull { it.height } ?: 0) {
                var x = 0
                tabs.forEach { tab -> tab.placeRelative(x, 0); x += tab.width }
            }
        }
    }
}

@Composable
internal fun NativeUnreadBadge(
    count: Int, modifier: Modifier = Modifier, containerColor: Color = Accent,
    contentColor: Color = AccentText, manualUnread: Boolean = false,
    countDescription: String = "Непрочитанных сообщений", fontSize: TextUnit = 11.sp
) {
    if (count <= 0 && !manualUnread) return
    val label = if (count > 99) "99+" else if (count > 0) count.toString() else "•"
    val diameter = when (label.length) { 1 -> 20.dp; 2 -> 24.dp; else -> 30.dp } *
        (LocalDensity.current.fontScale * fontSize.value / 11f).coerceAtLeast(1f)
    Box(
        modifier.sizeIn(maxWidth = diameter, maxHeight = diameter).aspectRatio(1f).size(diameter)
            .clip(CircleShape).background(containerColor).clearAndSetSemantics {
            contentDescription = if (count > 0) "$countDescription: $count" else "Помечено как непрочитанное"
        },
        contentAlignment = Alignment.Center
    ) {
        NativeText(label, color = contentColor, fontSize = fontSize, lineHeight = fontSize * 1.15f,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1, softWrap = false)
    }
}

// Material BadgedBox reports only the icon's height and places the badge above
// it. Reserve the whole circle here so the navigation pill cannot clip it or
// draw its label through the bottom of a large unread counter.
@Composable
internal fun NativeNavigationIconBadge(count: Int, content: @Composable () -> Unit) {
    Layout(content = {
        Box(contentAlignment = Alignment.Center) { content() }
        Box { NativeUnreadBadge(count, contentColor = Panel, fontSize = 10.sp, countDescription = "Непрочитанных чатов") }
    }) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val icon = measurables[0].measure(loose)
        val badge = measurables[1].measure(loose)
        val iconTop = (badge.height / 2 - 7.dp.roundToPx()).coerceAtLeast(0)
        val width = constraints.constrainWidth(icon.width + badge.width)
        val height = constraints.constrainHeight(maxOf(icon.height + iconTop, badge.height))
        layout(width, height) {
            // Symmetric reserved space keeps the icon centred over its label.
            icon.placeRelative((width - icon.width) / 2, height - icon.height)
            badge.placeRelative(width - badge.width, 0)
        }
    }
}
