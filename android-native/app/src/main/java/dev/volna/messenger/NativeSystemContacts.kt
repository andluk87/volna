package dev.volna.messenger

import android.Manifest
import android.accounts.*
import android.app.Service
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.provider.ContactsContract as C
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import androidx.activity.ComponentActivity
import kotlinx.coroutines.*
import org.json.JSONObject

internal data class NativeSystemContact(val source: String, val anchor: Long, val user: Long, val name: String)

/** Separate raw contacts owned by Volna. Never writes to a phone/Google/Samsung raw contact. */
internal object NativeSystemContacts {
    const val TYPE = "dev.volna.messenger.contacts"
    const val MIME = "vnd.android.cursor.item/vnd.dev.volna.messenger.contact"
    private val lock = Any()
    private val worker = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    fun accountName(account: Long) = "Волна · $account"
    private fun permitted(context: Context) = listOf(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)
        .all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    private fun rawUri() = C.RawContacts.CONTENT_URI.buildUpon().appendQueryParameter(C.CALLER_IS_SYNCADAPTER, "true").build()

    fun plan(book: JSONObject, local: Map<String, List<Pair<Long, String>>>): List<NativeSystemContact> {
        val result = linkedMapOf<String, NativeSystemContact>()
        val rows = book.optJSONArray("contacts") ?: return emptyList()
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val user = row.optJSONObject("user")?.optLong("id") ?: continue
            if (row.optBoolean("deleted") || user <= 0) continue
            val phones = row.optJSONArray("phone_numbers") ?: continue
            for (j in 0 until phones.length()) for ((raw, name) in local[phones.optString(j)].orEmpty()) {
                val source = "$user:$raw"
                result[source] = NativeSystemContact(source, raw, user, name)
            }
        }
        return result.values.toList()
    }

    fun update(context: Context, account: Long, book: JSONObject, sessionActive: () -> Boolean = { NativeCredentials.access(account).isNotBlank() }) = synchronized(lock) {
        val store = NativeContactBook(context, account)
        val enabled = store.prefs.getBoolean("enabled", false) && book.optBoolean("enabled")
        if (!enabled) { clearRows(context, account); return@synchronized }
        if (!permitted(context) || !sessionActive()) return@synchronized
        val resolver = context.contentResolver
        val own = mutableMapOf<String, Pair<Long, String>>()
        val ownIds = mutableSetOf<Long>()
        // Exclude every Volna account from local matching, including another signed-in account.
        resolver.query(C.RawContacts.CONTENT_URI, arrayOf(C.RawContacts._ID, C.RawContacts.SOURCE_ID, C.RawContacts.SYNC1, C.RawContacts.ACCOUNT_NAME),
            "${C.RawContacts.ACCOUNT_TYPE}=? AND ${C.RawContacts.DELETED}=0", arrayOf(TYPE), null)?.use { c ->
            while (c.moveToNext()) {
                ownIds += c.getLong(0)
                if (c.getString(3) == accountName(account)) own[c.getString(1).orEmpty()] = c.getLong(0) to c.getString(2).orEmpty()
            }
        } ?: error("Не удалось прочитать отметки контактов")
        val region = (context.getSystemService(Context.TELEPHONY_SERVICE) as? android.telephony.TelephonyManager)
            ?.networkCountryIso?.takeIf { it.isNotBlank() }?.uppercase(java.util.Locale.ROOT) ?: "RU"
        val local = linkedMapOf<String, MutableList<Pair<Long, String>>>()
        data class PhoneRow(val phone: String, val raw: Long, val contact: Long, val name: String)
        val phones = mutableListOf<PhoneRow>()
        resolver.query(C.CommonDataKinds.Phone.CONTENT_URI, arrayOf(C.CommonDataKinds.Phone.RAW_CONTACT_ID, C.CommonDataKinds.Phone.NUMBER, C.CommonDataKinds.Phone.DISPLAY_NAME, C.CommonDataKinds.Phone.CONTACT_ID), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val raw = c.getLong(0)
                if (raw in ownIds) continue
                val phone = nativeContactPhone(c.getString(1).orEmpty(), region) ?: continue
                phones += PhoneRow(phone, raw, c.getLong(3), c.getString(2).orEmpty())
            }
        } ?: error("Не удалось прочитать телефонную книгу")
        // A phone contact can already aggregate Google/Samsung/device raw contacts.
        // Attach one Volna action per person instead of duplicating it for every source.
        val anchors = phones.groupBy { it.contact }.mapValues { (_, rows) -> rows.minOf { it.raw } }
        for (phone in phones) local.getOrPut(phone.phone) { mutableListOf() }.add(anchors.getValue(phone.contact) to phone.name)
        val desired = plan(book, local)
        if (desired.isNotEmpty()) {
            val manager = AccountManager.get(context)
            val androidAccount = Account(accountName(account), TYPE)
            if (manager.getAccountsByType(TYPE).none { it == androidAccount } && !manager.addAccountExplicitly(androidAccount, null, null))
                error("Не удалось добавить аккаунт «Волна» в контакты Android")
            ContentResolver.setIsSyncable(androidAccount, C.AUTHORITY, 0)
        }
        for (row in desired) {
            val existing = own.remove(row.source)
            if (existing != null && existing.second == row.name) continue
            val ops = arrayListOf<ContentProviderOperation>()
            if (existing != null) ops += ContentProviderOperation.newDelete(rawUri()).withSelection("${C.RawContacts._ID}=? AND ${C.RawContacts.ACCOUNT_TYPE}=? AND ${C.RawContacts.ACCOUNT_NAME}=?", arrayOf(existing.first.toString(), TYPE, accountName(account))).build()
            val rawIndex = ops.size
            ops += ContentProviderOperation.newInsert(rawUri()).withValue(C.RawContacts.ACCOUNT_TYPE, TYPE)
                .withValue(C.RawContacts.ACCOUNT_NAME, accountName(account)).withValue(C.RawContacts.SOURCE_ID, row.source)
                .withValue(C.RawContacts.SYNC1, row.name).withValue(C.RawContacts.AGGREGATION_MODE, C.RawContacts.AGGREGATION_MODE_DEFAULT).build()
            ops += ContentProviderOperation.newInsert(C.Data.CONTENT_URI).withValueBackReference(C.Data.RAW_CONTACT_ID, rawIndex)
                .withValue(C.Data.MIMETYPE, MIME).withValue(C.Data.DATA1, row.user.toString()).withValue(C.Data.DATA2, "Волна")
                .withValue(C.Data.DATA3, "Написать в Волне").withValue(C.Data.DATA4, account.toString()).build()
            ops += ContentProviderOperation.newUpdate(C.AggregationExceptions.CONTENT_URI)
                .withValue(C.AggregationExceptions.TYPE, C.AggregationExceptions.TYPE_KEEP_TOGETHER)
                .withValueBackReference(C.AggregationExceptions.RAW_CONTACT_ID1, rawIndex)
                .withValue(C.AggregationExceptions.RAW_CONTACT_ID2, row.anchor).build()
            resolver.applyBatch(C.AUTHORITY, ops)
        }
        for ((id, _) in own.values) resolver.delete(rawUri(), "${C.RawContacts._ID}=? AND ${C.RawContacts.ACCOUNT_TYPE}=? AND ${C.RawContacts.ACCOUNT_NAME}=?", arrayOf(id.toString(), TYPE, accountName(account)))
    }

    private fun clearRows(context: Context, account: Long) {
        if (permitted(context)) {
            val selection = "${C.RawContacts.ACCOUNT_TYPE}=? AND ${C.RawContacts.ACCOUNT_NAME}=?"
            val args = arrayOf(TYPE, accountName(account))
            val hasRows = context.contentResolver.query(C.RawContacts.CONTENT_URI, arrayOf(C.RawContacts._ID), selection, args, null)?.use { it.moveToFirst() } == true
            if (hasRows) context.contentResolver.delete(rawUri(), selection, args)
        }
        AccountManager.get(context).getAccountsByType(TYPE).filter { it.name == accountName(account) }.forEach { AccountManager.get(context).removeAccountExplicitly(it) }
    }
    fun disable(context: Context, account: Long) {
        NativeContactBook(context, account).prefs.edit().putBoolean("enabled", false).commit()
        worker.launch { runCatching { synchronized(lock) { clearRows(context.applicationContext, account) } } }
    }
    fun isDataUri(uri: Uri?) = uri?.scheme == "content" && uri.authority == C.AUTHORITY && uri.pathSegments.size == 2 && uri.pathSegments[0] == "data" && (uri.lastPathSegment?.toLongOrNull() ?: 0) > 0
}

/** Android uses this owner to label the linked raw contact and its custom action. No tokens are stored here. */
class VolnaContactsAuthenticatorService : Service() {
    private val authenticator by lazy { object : AbstractAccountAuthenticator(this) {
        private fun unsupported() = Bundle().apply { putInt(AccountManager.KEY_ERROR_CODE, AccountManager.ERROR_CODE_UNSUPPORTED_OPERATION) }
        override fun editProperties(r: AccountAuthenticatorResponse?, type: String?) = unsupported()
        override fun addAccount(r: AccountAuthenticatorResponse?, type: String?, token: String?, features: Array<out String>?, options: Bundle?) = unsupported()
        override fun confirmCredentials(r: AccountAuthenticatorResponse?, account: Account?, options: Bundle?) = unsupported()
        override fun getAuthToken(r: AccountAuthenticatorResponse?, account: Account?, type: String?, options: Bundle?) = unsupported()
        override fun getAuthTokenLabel(type: String?) = ""
        override fun updateCredentials(r: AccountAuthenticatorResponse?, account: Account?, type: String?, options: Bundle?) = unsupported()
        override fun hasFeatures(r: AccountAuthenticatorResponse?, account: Account?, features: Array<out String>?) = Bundle().apply { putBoolean(AccountManager.KEY_BOOLEAN_RESULT, false) }
    } }
    override fun onBind(intent: Intent?): IBinder = authenticator.iBinder
}

class VolnaContactsSyncService : Service() {
    private val adapter by lazy { object : AbstractThreadedSyncAdapter(this, true) {
        override fun onPerformSync(account: Account?, extras: Bundle?, authority: String?, provider: ContentProviderClient?, result: SyncResult?) = Unit
    } }
    override fun onBind(intent: Intent?): IBinder = adapter.syncAdapterBinder
}

class VolnaContactActionActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent?.data
        if (intent?.action != Intent.ACTION_VIEW || !NativeSystemContacts.isDataUri(uri)) { finish(); return }
        lifecycleScope.launch {
            try {
                val target = withContext(Dispatchers.IO) {
                    contentResolver.query(uri!!, arrayOf(C.Data.DATA1, C.Data.DATA4, C.RawContacts.ACCOUNT_TYPE, C.RawContacts.ACCOUNT_NAME), "${C.Data.MIMETYPE}=?", arrayOf(NativeSystemContacts.MIME), null)?.use { c ->
                        if (!c.moveToFirst() || c.getString(2) != NativeSystemContacts.TYPE) return@use null
                        val user = c.getString(0)?.toLongOrNull() ?: return@use null
                        val account = c.getString(1)?.toLongOrNull() ?: return@use null
                        if (user <= 0 || account <= 0 || c.getString(3) != NativeSystemContacts.accountName(account)) return@use null
                        account to user
                    }
                } ?: error("Контакт больше не связан с Волной")
                val token = NativeCredentials.access(target.first)
                check(token.isNotBlank()) { "Войдите в аккаунт Волны" }
                val chat = withContext(Dispatchers.IO) { NativeApi(BuildConfig.API_BASE_URL).startChat(token, target.second) }
                check(NativeCredentials.access(target.first).isNotBlank()) { "Аккаунт отключён" }
                startActivity(Intent(this@VolnaContactActionActivity, MainActivity::class.java)
                    .putExtra("account_id", target.first).putExtra("chat_id", chat))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { Toast.makeText(this@VolnaContactActionActivity, "Не удалось открыть контакт. Откройте Волну и проверьте доступ к контактам и соединение", Toast.LENGTH_LONG).show() }
            finally { finish() }
        }
    }
}
