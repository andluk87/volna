package dev.volna.messenger

/** Notification labels use a person's name; login handles and phone numbers stay out of titles. */
internal fun nativeNotificationName(
    custom: String = "",
    phonebook: String = "",
    profile: String = "",
    username: String = "",
    firstName: String = "",
    lastName: String = "",
    fallback: String = "Пользователь"
): String {
    val handle = username.trim().removePrefix("@")
    fun clean(value: String, humanFields: Boolean = false): String? {
        var name = value.trim()
        if (name.isBlank() || name.equals("null", ignoreCase = true)) return null
        // Old profiles occasionally include a separate @handle after the display name.
        name = name.replace(Regex("(?<![\\p{L}\\p{N}_])\\(?@[a-zA-Z0-9_]+\\)?"), "")
            .trim().trim('·', '|', ',', ';', '-', '(', ')').trim()
        if (name.isBlank() || Regex("[+0-9() .-]+").matches(name)) return null
        if (!humanFields && handle.isNotBlank() && name.equals(handle, ignoreCase = true)) return null
        return name
    }
    return clean(custom) ?: clean(phonebook)
        ?: clean(listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" "), humanFields = true)
        ?: clean(profile) ?: fallback
}

internal fun nativeNotificationTitle(sender: String, group: String, topic: String, isTopic: Boolean): String {
    if (!isTopic) return sender
    val groupName = group.trim().ifBlank { "Группа" }
    val topicName = topic.trim()
    return if (topicName.isBlank()) groupName else "$groupName › $topicName"
}

internal fun nativeNotificationBrandTitle(title:String,enabled:Boolean)=if(enabled)"🌊 Волна · $title" else title
