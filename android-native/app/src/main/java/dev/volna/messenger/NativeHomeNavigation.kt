package dev.volna.messenger

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeHomeNavigation(selected: String, user: VolnaUser?, token: String, unread: Int,
    onSelect: (String) -> Unit, onProfile: () -> Unit, modifier: Modifier = Modifier) {
    val style = LocalNativeAppearance.current.navigationStyle
    val colors = nativePillColors(style)
    Box(modifier.clip(RoundedCornerShape(style.radius.dp)).background(colors.surface).padding(3.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = style.height.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf(Triple("chats", "Чаты", Icons.Outlined.ChatBubbleOutline), Triple("contacts", "Контакты", Icons.Outlined.AccountCircle),
                if (style.thirdTab == "calls") Triple("calls", "Звонки", Icons.Outlined.Call) else Triple("profile", "Настройки", Icons.Outlined.Settings), Triple("account", "Профиль", Icons.Outlined.PersonOutline)).forEach { (key, label, icon) ->
                val active = selected == key
                val tint = if (active) colors.selectedText else colors.text
                Column(Modifier.weight(1f).heightIn(min = style.height.dp).clip(RoundedCornerShape(style.radius.dp)).background(if (active) colors.selected else Color.Transparent)
                    .semantics { contentDescription = label }.clickable { if (key == "account") onProfile() else onSelect(key) }.padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    if (style.icons) NativeNavigationIconBadge(if (key == "chats" && style.badges) unread else 0) {
                        if (key == "account") Avatar(user?.name ?: "В", user?.id ?: 0, user?.avatarUrl, token, size = style.iconSize.dp)
                        else Icon(icon, label, tint = tint, modifier = Modifier.size(style.iconSize.dp))
                    }
                    if (style.labels) Row(verticalAlignment = Alignment.CenterVertically) {
                        NativeText(label, color = tint, fontSize = style.textSize.sp, modifier = Modifier.weight(1f, fill = false).padding(top = if (style.icons) 3.dp else 0.dp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        if (!style.icons && style.badges && key == "chats") NativeUnreadBadge(unread, Modifier.padding(start = 3.dp), fontSize = 10.sp)
                    }
                }
            }
        }
    }
}
