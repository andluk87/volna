package dev.volna.messenger

/** Keep display names, including legacy names equal to a login; omit appended @handles. */
internal fun nativeNotificationName(
    custom: String = "",
    phonebook: String = "",
    profile: String = "",
    username: String = "",
    firstName: String = "",
    lastName: String = "",
    fallback: String = "Пользователь",
    alternateNames: List<String> = emptyList()
): String {
    fun clean(value: String): String? {
        val name = value.trim().takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }
            ?: return null
        // Only remove a separate suffix, never the actual display name or words inside it.
        val withoutSuffix = name.replace(Regex("\\s+(?:[·|,;—–-]\\s*)?\\(?@[a-zA-Z0-9_]+\\)?$"), "").trim()
        return withoutSuffix.takeIf { it.isNotBlank() }
    }
    val humanName = listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" ")
    // Username is intentionally not a name candidate. Equality with it does not invalidate a name.
    return sequenceOf(custom, phonebook, humanName, profile).plus(alternateNames.asSequence())
        .mapNotNull(::clean).firstOrNull { it != "Пользователь" && it != "Собеседник" }
        ?: fallback
}

internal fun nativeNotificationTitle(sender: String, group: String, topic: String, isTopic: Boolean): String {
    if (!isTopic) return sender
    val groupName = group.trim().ifBlank { "Группа" }
    val topicName = topic.trim()
    return if (topicName.isBlank()) groupName else "$groupName › $topicName"
}

internal fun nativeNotificationBrandTitle(title:String,enabled:Boolean)=if(enabled)"🌊 VLN · $title" else title
