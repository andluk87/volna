package dev.volna.messenger

import org.json.JSONObject

data class NativeNavigationStyle(
    val height: Int = 40, val radius: Int = 24, val sideInset: Int = 10,
    val textSize: Int = 14, val iconSize: Int = 23,
    val labels: Boolean = true, val icons: Boolean = true, val badges: Boolean = true,
    val surface: Long = 0, val selected: Long = 0, val text: Long = 0, val selectedText: Long = 0
) {
    fun json(): String = JSONObject().put("height", height).put("radius", radius).put("sideInset", sideInset)
        .put("textSize", textSize).put("iconSize", iconSize).put("labels", labels).put("icons", icons).put("badges", badges)
        .put("surface", surface).put("selected", selected).put("text", text).put("selectedText", selectedText).toString()
    companion object {
        val Folders = NativeNavigationStyle()
        val Bottom = NativeNavigationStyle(height = 52, radius = 32, sideInset = 28, textSize = 10)
        fun parse(raw: String?, defaults: NativeNavigationStyle): NativeNavigationStyle = runCatching {
            val o = JSONObject(raw ?: return defaults)
            fun color(key: String) = o.optLong(key).takeIf { it == 0L || it in 0xFF000000L..0xFFFFFFFFL } ?: 0L
            val labels = o.optBoolean("labels", true)
            defaults.copy(height = o.optInt("height", defaults.height).coerceIn(36, 80), radius = o.optInt("radius", defaults.radius).coerceIn(0, 40),
                sideInset = o.optInt("sideInset", defaults.sideInset).coerceIn(0, 40), textSize = o.optInt("textSize", defaults.textSize).coerceIn(10, 20),
                iconSize = o.optInt("iconSize", defaults.iconSize).coerceIn(18, 32), labels = labels, icons = !labels || o.optBoolean("icons", true),
                badges = o.optBoolean("badges", true), surface = color("surface"), selected = color("selected"), text = color("text"), selectedText = color("selectedText"))
        }.getOrDefault(defaults)
    }
}
