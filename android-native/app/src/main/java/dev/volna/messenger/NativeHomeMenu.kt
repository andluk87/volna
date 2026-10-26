package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeHomeMenu(expanded: Boolean, dark: Boolean, dismiss: () -> Unit,
    onTheme: () -> Unit, onGroup: () -> Unit, onSaved: () -> Unit, onSettings: () -> Unit,
    onNewChat: () -> Unit, onChannel: () -> Unit, onJoin: () -> Unit, onArchive: () -> Unit, onAccounts: () -> Unit) {
    var more by remember { mutableStateOf(false) }
    LaunchedEffect(expanded) { if (!expanded) more = false }
    DropdownMenu(expanded, dismiss, modifier = Modifier.width(256.dp), shape = RoundedCornerShape(14.dp),
        containerColor = Panel, tonalElevation = 0.dp) {
        @Composable fun entry(title: String, icon: ImageVector, action: () -> Unit) {
            DropdownMenuItem(text = { NativeText(title, color = TextMain, fontSize = 18.sp) },
                leadingIcon = { Icon(icon, null, tint = TextMain, modifier = Modifier.size(26.dp)) },
                modifier = Modifier.heightIn(min = 56.dp), contentPadding = PaddingValues(horizontal = 20.dp),
                onClick = { dismiss(); action() })
        }
        entry(if (dark) "Дневной режим" else "Ночной режим", if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, onTheme)
        HorizontalDivider(color = Ink.copy(alpha = .45f), thickness = 8.dp)
        entry("Создать группу", Icons.Outlined.Groups, onGroup)
        entry("Избранное", Icons.Outlined.BookmarkBorder, onSaved)
        entry("Настройки", Icons.Outlined.Settings, onSettings)
        HorizontalDivider(color = Ink.copy(alpha = .45f), thickness = 8.dp)
        DropdownMenuItem(text = { NativeText(if (more) "Свернуть" else "Ещё", color = TextMain, fontSize = 18.sp) },
            leadingIcon = { Icon(if (more) Icons.Outlined.ExpandLess else Icons.Outlined.MoreHoriz, null, tint = TextMain, modifier = Modifier.size(26.dp)) },
            modifier = Modifier.heightIn(min = 56.dp), contentPadding = PaddingValues(horizontal = 20.dp), onClick = { more = !more })
        if (more) {
            entry("Новый чат", Icons.Outlined.ChatBubbleOutline, onNewChat)
            entry("Создать канал", Icons.Outlined.Campaign, onChannel)
            entry("Войти по приглашению", Icons.Outlined.Link, onJoin)
            entry("Архив", Icons.Outlined.Archive, onArchive)
            entry("Аккаунты", Icons.Outlined.ManageAccounts, onAccounts)
        }
    }
}
