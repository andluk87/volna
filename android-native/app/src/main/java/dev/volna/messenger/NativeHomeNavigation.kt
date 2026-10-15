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
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeHomeNavigation(selected: String, user: VolnaUser?, token: String, unread: Int,
    onSelect: (String) -> Unit, onProfile: () -> Unit, modifier: Modifier = Modifier) {
    val colors = nativePillColors()
    Box(modifier.clip(RoundedCornerShape(32.dp)).background(colors.surface).padding(3.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf(Triple("chats", "Чаты", Icons.Outlined.ChatBubbleOutline), Triple("contacts", "Контакты", Icons.Outlined.AccountCircle),
                Triple("profile", "Настройки", Icons.Outlined.Settings), Triple("account", "Профиль", Icons.Outlined.PersonOutline)).forEach { (key, label, icon) ->
                val active = selected == key
                val tint = if (active) colors.selectedText else colors.text
                Column(Modifier.weight(1f).clip(CircleShape).background(if (active) colors.selected else Color.Transparent)
                    .clickable { if (key == "account") onProfile() else onSelect(key) }.padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    NativeNavigationIconBadge(if (key == "chats") unread else 0) {
                        if (key == "account") Avatar(user?.name ?: "В", user?.id ?: 0, user?.avatarUrl, token, size = 23.dp)
                        else Icon(icon, label, tint = tint, modifier = Modifier.size(23.dp))
                    }
                    NativeText(label, color = tint, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
                }
            }
        }
    }
}
