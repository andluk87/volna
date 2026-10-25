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
        val HeightRange = 24..160
        val RadiusRange = 0..80
        val SideInsetRange = 0..80
        val TextSizeRange = 8..32
        val IconSizeRange = 12..64
        val Folders = NativeNavigationStyle()
        val Bottom = NativeNavigationStyle(height = 52, radius = 32, sideInset = 28, textSize = 10)
        fun parse(raw: String?, defaults: NativeNavigationStyle): NativeNavigationStyle = runCatching {
            val o = JSONObject(raw ?: return defaults)
            fun color(key: String) = o.optLong(key).takeIf { it == 0L || it in 0xFF000000L..0xFFFFFFFFL } ?: 0L
            // Restore horizontal defaults for saved 0.12.60–61 rail settings,
            // keeping older/custom horizontal appearance and custom colours.
            val rail = defaults == Folders && o.optBoolean("vertical", false)
            fun size(key: String, fallback: Int, railDefault: Int): Int {
                val value = o.optInt(key, fallback)
                return if (rail && value == railDefault) fallback else value
            }
            val labels = if (rail) defaults.labels else o.optBoolean("labels", true)
            defaults.copy(height = size("height", defaults.height, 72).coerceIn(HeightRange), radius = o.optInt("radius", defaults.radius).coerceIn(RadiusRange),
                sideInset = size("sideInset", defaults.sideInset, 4).coerceIn(SideInsetRange), textSize = o.optInt("textSize", defaults.textSize).coerceIn(TextSizeRange),
                iconSize = size("iconSize", defaults.iconSize, 46).coerceIn(IconSizeRange), labels = labels, icons = !labels || o.optBoolean("icons", true),
                badges = o.optBoolean("badges", true), surface = color("surface"), selected = color("selected"), text = color("text"), selectedText = color("selectedText"))
        }.getOrDefault(defaults)
    }
}
