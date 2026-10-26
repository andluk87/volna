package dev.volna.messenger

import org.junit.Assert.*
import org.junit.Test

class NativePinnedPreviewTest {
    private fun message(name: String? = null, mime: String? = null, text: String = "", kind: String? = null) =
        VolnaMessage(42, 1, "Автор", text, "2026-10-27T00:00:00Z", false, name,
            attachmentId = if (name != null || mime != null) "a".repeat(48) else null, attachmentMime = mime, expressionKind = kind)

    @Test fun recordingsFromAndroidWebAndLegacyCacheHaveAHumanReadableLabel() {
        for ((name, mime) in listOf("Голосовое-1791466172348.m4a" to "audio/mp4", "Голосовое-1791466172348.webm" to "audio/webm", "Голосовое-legacy.m4a" to null)) {
            val voice = message(name, mime)
            assertEquals("Голосовое сообщение", nativePinnedPreview(voice))
            assertEquals(name, voice.attachmentName)
        }
    }
    @Test fun captionsAndEmojiStayVisibleAndDeletedMessagesHaveNoAttachmentPreview() {
        assertEquals("Заметка 👍 в две строки", nativePinnedPreview(message("photo.jpg", "image/jpeg", "Заметка 👍\nв две строки")))
        assertEquals("Сообщение удалено", nativePinnedPreview(message("Голосовое-123.m4a", "audio/mp4").copy(deleted = true)))
    }
    @Test fun mediaUseTheirTypeInsteadOfTechnicalFileNames() {
        assertEquals("Фото", nativePinnedPreview(message("upload-123.jpg", "image/jpeg")))
        assertEquals("Видео", nativePinnedPreview(message("upload-123.mp4", "video/mp4")))
        assertEquals("GIF", nativePinnedPreview(message("upload.gif", "image/gif")))
        assertEquals("Стикер", nativePinnedPreview(message("asset.webp", "image/webp", kind = "sticker")))
        assertEquals("Эмодзи", nativePinnedPreview(message(kind = "emoji")))
    }
    @Test fun meaningfulDocumentAndMusicNamesArePreserved() {
        assertEquals("Отчёт.pdf", nativePinnedPreview(message("Отчёт.pdf", "application/pdf")))
        assertEquals("Песня.mp3", nativePinnedPreview(message("Песня.mp3", "audio/mpeg")))
        assertEquals("Файл", nativePinnedPreview(message("a".repeat(48), "application/octet-stream")))
        assertEquals("Аудиофайл", nativePinnedPreview(message(mime = "audio/mpeg")))
        assertEquals("Сообщение", nativePinnedPreview(message()))
    }
}
