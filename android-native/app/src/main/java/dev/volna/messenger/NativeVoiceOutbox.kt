package dev.volna.messenger

import android.content.Context
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/** Keeps the same client ID and uploaded attachment when retrying a voice message. */
internal object NativeVoiceOutbox {
    fun batch(context: Context, account: Long, chat: Long, file: File, reply: Long?, onSent: () -> Unit): NativeAttachmentBatch {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        return NativeAttachmentBatch(chat, listOf(NativeSelectedAttachment(uri, "Голосовое-${System.currentTimeMillis()}.m4a", "audio/mp4")), "", reply, onSent, voiceFile = file, account = account)
    }
    fun save(batch: NativeAttachmentBatch) {
        val file = batch.voiceFile ?: return
        val value = JSONObject().put("account", batch.account).put("chat", batch.chatId).put("reply", batch.replyId)
            .put("client", batch.clientId).put("name", batch.files.first().name).put("upload", batch.uploads[0])
        val target = File(file.absolutePath + ".json")
        val temporary = File(target.absolutePath + ".tmp")
        temporary.writeText(value.toString())
        check(temporary.renameTo(target)) { "Не удалось сохранить запись для повторной отправки" }
    }
    fun load(context: Context, account: Long): NativeAttachmentBatch? {
        if (account <= 0) return null
        val directory = File(context.filesDir, "voice-drafts")
        return directory.listFiles().orEmpty().filter { it.name.endsWith(".m4a.json") }.sortedByDescending { it.lastModified() }.firstNotNullOfOrNull { metadata ->
            runCatching {
                val row = JSONObject(metadata.readText())
                if (row.getLong("account") != account) return@runCatching null
                val file = File(metadata.absolutePath.removeSuffix(".json"))
                if (!file.isFile || file.length() == 0L) { metadata.delete(); return@runCatching null }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                NativeAttachmentBatch(row.getLong("chat"), listOf(NativeSelectedAttachment(uri, row.getString("name"), "audio/mp4")), "",
                    if (row.isNull("reply")) null else row.getLong("reply"), {}, row.getString("client"), file, account).also { batch ->
                    if (!row.isNull("upload")) batch.uploads[0] = row.getString("upload")
                }
            }.getOrNull()
        }
    }
    fun remove(batch: NativeAttachmentBatch) {
        batch.voiceFile?.let { file -> file.delete(); File(file.absolutePath + ".json").delete(); File(file.absolutePath + ".json.tmp").delete() }
    }
    fun clear(context: Context, account: Long) {
        File(context.filesDir, "voice-drafts").listFiles().orEmpty().filter { it.name.endsWith(".m4a.json") }.forEach { metadata ->
            runCatching { if (JSONObject(metadata.readText()).getLong("account") == account) { File(metadata.absolutePath.removeSuffix(".json")).delete(); metadata.delete() } }
        }
    }
}
