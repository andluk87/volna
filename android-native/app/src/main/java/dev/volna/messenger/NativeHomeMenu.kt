package dev.volna.messenger

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Main actions stay compact; less frequent actions remain available under More. */
@Composable
internal fun NativeHomeMenu(expanded: Boolean, onDismiss: () -> Unit, onTheme: (Boolean) -> Unit,
    onGroup: () -> Unit, onSaved: () -> Unit, onSettings: () -> Unit, onNewChat: () -> Unit,
    onChannel: () -> Unit, onJoin: () -> Unit, onArchive: () -> Unit, onAccounts: () -> Unit
) {
    var more by remember { mutableStateOf(false) }
    LaunchedEffect(expanded) { if (!expanded) more = false }
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    val surface = lerp(Panel, Hover, .5f)
    @Composable fun Item(label: String, icon: ImageVector, action: () -> Unit) {
        DropdownMenuItem(text = { NativeText(label, color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.Normal) },
            leadingIcon = { Icon(icon, null, tint = TextMain) }, modifier = Modifier.height(48.dp),
            onClick = action)
    }
    fun select(action: () -> Unit) { onDismiss(); action() }
    DropdownMenu(expanded, onDismiss, Modifier.width(216.dp), offset = DpOffset(0.dp, (-48).dp),
        shape = RoundedCornerShape(12.dp), containerColor = surface, tonalElevation = 0.dp, shadowElevation = 6.dp) {
        if (!more) {
            Item(if (dark) "Дневной режим" else "Ночной режим", if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode) { select { onTheme(!dark) } }
            HorizontalDivider(color = Ink.copy(alpha = .3f))
            Item("Создать группу", Icons.Outlined.Groups) { select(onGroup) }
            Item("Избранное", Icons.Outlined.BookmarkBorder) { select(onSaved) }
            Item("Настройки", Icons.Outlined.Settings) { select(onSettings) }
            HorizontalDivider(color = Ink.copy(alpha = .3f))
            Item("Ещё", Icons.Outlined.MoreHoriz) { more = true }
        } else {
            Item("Назад", Icons.Outlined.ArrowBack) { more = false }
            HorizontalDivider(color = Ink.copy(alpha = .3f))
            Item("Новый чат", Icons.Outlined.ChatBubbleOutline) { select(onNewChat) }
            Item("Создать канал", Icons.Outlined.Campaign) { select(onChannel) }
            Item("Войти по приглашению", Icons.Outlined.Link) { select(onJoin) }
            Item("Архив", Icons.Outlined.Archive) { select(onArchive) }
            Item("Аккаунты", Icons.Outlined.ManageAccounts) { select(onAccounts) }
        }
    }
}
