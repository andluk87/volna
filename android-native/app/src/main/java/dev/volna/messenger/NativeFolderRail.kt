package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal fun nativeFolderUnread(folder: NativeFolder, chats: List<VolnaChat>, tabs: List<NativeFolder>): Int =
    chats.count { (it.unread > 0 || it.manualUnread) &&
        if (folder.rule == "all") nativeUnassignedChat(it, tabs) && nativeChatFilter(it, "all") else nativeFolderMatches(folder, it) }

@Composable
internal fun NativeFolderRail(folders: List<NativeFolder>, chats: List<VolnaChat>, selected: String,
    onSelect: (String) -> Unit, modifier: Modifier = Modifier, bottomInset: Dp = 0.dp) {
    val tabs = nativeNavigationFolders(folders, chats)
    if (tabs.isEmpty()) return
    val style = LocalNativeAppearance.current.foldersStyle
    val colors = nativePillColors(style)
    val iconSize = style.iconSize.dp
    val railWidth = maxOf(64, style.iconSize + 24 + style.sideInset.coerceAtMost(12)).dp
    LazyColumn(modifier.width(railWidth).background(colors.surface),
        contentPadding = PaddingValues(top = 6.dp, bottom = bottomInset), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items(tabs, key = { it.id }) { folder ->
            val folderKey = if (folder.rule == "all") "all" else "folder:${folder.id}"
            val active = selected == folderKey
            val folderColor = folder.color.takeIf { it in nativeFolderColors }
                ?: if (folder.rule.isBlank()) nativeFolderColors[Math.floorMod(folder.id.hashCode(), nativeFolderColors.size)] else null
            val customColor = folderColor?.let { Color(android.graphics.Color.parseColor(it)) }
            val tint = if (active) colors.selectedText else colors.text
            Box(Modifier.fillMaxWidth().heightIn(min = maxOf(64, style.height).dp)
                .semantics { contentDescription = folder.name }
                .selectable(selected = active, role = Role.Tab, onClick = { onSelect(folderKey) }), contentAlignment = Alignment.Center) {
                if (active) Box(Modifier.align(Alignment.CenterStart).width(3.dp).height(36.dp)
                    .clip(RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp)).background(Accent))
                Column(Modifier.padding(horizontal = 6.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(iconSize + 6.dp), contentAlignment = Alignment.Center) {
                        Box(Modifier.size(iconSize).clip(CircleShape).background(customColor ?: if (active) colors.selected else colors.surface)
                            .then(if (active) Modifier.border(2.dp, Accent, CircleShape) else Modifier), contentAlignment = Alignment.Center) {
                            if (style.icons && folder.icon.isNotBlank()) NativeText(folder.icon, fontSize = (style.iconSize * .50f).coerceIn(8f, 32f).sp, maxLines = 1)
                            else if (style.icons && folder.rule.isBlank()) NativeText(folder.name.take(1).uppercase(),
                                color = Color.White, fontSize = (style.iconSize * .45f).sp, fontWeight = FontWeight.SemiBold)
                            else if (style.icons) Icon(when (folder.rule) {
                                "all" -> Icons.Outlined.ChatBubbleOutline
                                "archived" -> Icons.Outlined.Archive
                                "direct" -> Icons.Outlined.PersonOutline
                                "group" -> Icons.Outlined.Groups
                                "channel" -> Icons.Outlined.Campaign
                                "unread" -> Icons.Outlined.MarkChatUnread
                                else -> Icons.Outlined.Folder
                            }, null, tint = if (customColor != null) Color.White else tint, modifier = Modifier.size(iconSize * .55f))
                            else NativeText(folder.name.take(1).uppercase(), color = tint, fontSize = style.textSize.sp, fontWeight = FontWeight.SemiBold)
                        }
                        if (style.badges) NativeUnreadBadge(nativeFolderUnread(folder, chats, tabs), Modifier.align(Alignment.BottomEnd),
                            containerColor = if (active) Accent else Muted, contentColor = Panel, fontSize = 10.sp,
                            countDescription = "Непрочитанных чатов")
                    }
                    if (style.labels) NativeText(folder.name, color = tint, fontSize = style.textSize.sp,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
