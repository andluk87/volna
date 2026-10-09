package dev.volna.messenger

import android.app.Application
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// No access or refresh token is persisted in ordinary preferences or the chat cache.
internal object NativeCredentials {
    private lateinit var context: Context
    private val aliases = mutableMapOf<String, Long>()
    private const val keyName = "volna-phone-sessions-v1"
    private fun prefs() = context.getSharedPreferences("volna-secure-sessions", 0)
    fun initialize(app: Context) {
        context = app.applicationContext
        val state = context.getSharedPreferences("volna-native", 0)
        if (state.getInt("auth_generation", 0) != 2) {
            state.edit().remove("token").remove("user_id").putInt("auth_generation", 2).apply()
            context.getSharedPreferences("volna-accounts", 0).edit().clear().apply()
            context.getSharedPreferences("volna-service", 0).edit().clear().apply()
            context.deleteDatabase("volna-cache.db")
            java.io.File(context.filesDir,"voice-drafts").deleteRecursively()
            java.io.File(context.applicationInfo.dataDir,"shared_prefs").listFiles().orEmpty().filter { it.name.startsWith("volna-drafts-") }.forEach { context.getSharedPreferences(it.name.removeSuffix(".xml"),0).edit().clear().apply() }
        }
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(keyName, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyName, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun read(id: Long): JSONObject? = runCatching {
        val encoded = prefs().getString(id.toString(), null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }.getOrNull()
    @Synchronized fun store(session: VolnaSession) {
        val old = read(session.user.id)?.optString("access").orEmpty()
        if (old.isNotBlank()) aliases[old] = session.user.id
        aliases[session.token] = session.user.id
        val value = JSONObject().put("access", session.token).put("refresh", session.refreshToken).toString()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(prefs().edit().putString(session.user.id.toString(), Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "Не удалось сохранить защищённый сеанс" }
    }
    @Synchronized fun access(id: Long): String = read(id)?.optString("access").orEmpty()
    @Synchronized fun resolve(token: String): String = account(token)?.let { access(it) }?.ifBlank { token } ?: token
    @Synchronized fun refresh(token: String): String? = account(token)?.let { read(it)?.optString("refresh") }?.takeIf { it.isNotBlank() }
    private fun account(token: String): Long? = aliases[token] ?: prefs().all.keys.mapNotNull { it.toLongOrNull() }.firstOrNull { read(it)?.optString("access") == token }
    @Synchronized fun remove(id: Long) { prefs().edit().remove(id.toString()).commit(); aliases.entries.removeAll { it.value == id } }
    val refreshLock = Any()
}
