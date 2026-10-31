package dev.volna.messenger

import android.Manifest
import android.accounts.AccountManager
import android.app.Application
import android.content.*
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.ContactsContract as C
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeSystemContactsTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private lateinit var provider: BookProvider
    private fun book(vararg users: Long) = JSONObject().put("enabled", true).put("contacts", JSONArray(users.map {
        JSONObject().put("user", JSONObject().put("id", it)).put("phone_numbers", JSONArray().put("+79991234567"))
    }))
    @Before fun setup() {
        shadowOf(context).grantPermissions(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS, Manifest.permission.WRITE_SYNC_SETTINGS)
        shadowOf(AccountManager.get(context)).addAuthenticator(NativeSystemContacts.TYPE)
        provider = BookProvider()
        provider.attachInfo(context, android.content.pm.ProviderInfo().apply { authority = C.AUTHORITY })
        ShadowContentResolver.registerProviderInternal(C.AUTHORITY, provider)
        for (id in listOf(10L, 20L)) NativeContactBook(context, id).prefs.edit().clear().putBoolean("enabled", true).commit()
    }
    @Test fun matchesOnlyRegisteredLocalPhonesAndDeduplicatesRepeatedNumbers() {
        val value = book(7, 7)
        value.getJSONArray("contacts").put(JSONObject().put("phone_numbers", JSONArray().put("+79991234567")))
        value.getJSONArray("contacts").put(JSONObject().put("user", JSONObject().put("id", 8)).put("deleted", true).put("phone_numbers", JSONArray().put("+79991234567")))
        value.getJSONArray("contacts").put(JSONObject().put("user", JSONObject().put("id", 9)).put("phone_numbers", JSONArray().put("+79990000000")))
        val rows = NativeSystemContacts.plan(value, mapOf("+79991234567" to listOf(1L to "Мама", 1L to "Мама")))
        assertEquals(listOf(NativeSystemContact("7:1", 1, 7, "Мама")), rows)
    }
    @Test fun ownedLinksAreIdempotentAndRemovedWithoutChangingOriginalOrAnotherAccount() {
        NativeSystemContacts.update(context, 10, book(7)) { true }
        assertEquals(1, provider.raw.size)
        assertEquals(1, provider.data.size)
        assertEquals(1L, provider.links.single().second)
        assertEquals(NativeSystemContacts.MIME, provider.data.values.last().getAsString(C.Data.MIMETYPE))
        assertEquals("Волна", provider.data.values.last().getAsString(C.Data.DATA2))
        val writes = provider.writes
        NativeSystemContacts.update(context, 10, book(7)) { true }
        assertEquals(writes, provider.writes)
        NativeSystemContacts.update(context, 20, book(7)) { true }
        assertEquals(2, provider.raw.size)
        NativeSystemContacts.update(context, 10, book()) { true }
        assertEquals(1, provider.raw.size)
        assertEquals(NativeSystemContacts.accountName(20), provider.raw.values.single().getAsString(C.RawContacts.ACCOUNT_NAME))
        assertEquals(0, provider.foreignWrites)
    }
    @Test fun noWritesWithoutPermissionOrSessionAndDisabledSyncRemovesOnlyOwnedRows() {
        shadowOf(context).denyPermissions(Manifest.permission.WRITE_CONTACTS)
        NativeSystemContacts.update(context, 10, book(7)) { true }
        assertEquals(0, provider.writes)
        shadowOf(context).grantPermissions(Manifest.permission.WRITE_CONTACTS)
        NativeSystemContacts.update(context, 10, book(7)) { false }
        assertEquals(0, provider.writes)
        NativeSystemContacts.update(context, 10, book(7)) { true }
        NativeContactBook(context, 10).prefs.edit().putBoolean("enabled", false).commit()
        NativeSystemContacts.update(context, 10, book(7)) { true }
        assertTrue(provider.raw.isEmpty())
        assertEquals(0, provider.foreignWrites)
    }
    @Test fun systemContactsCanReadTheAccountTypeAndActionMetadata() {
        val pm = context.packageManager
        val info = pm.getServiceInfo(ComponentName(context, VolnaContactsSyncService::class.java), android.content.pm.PackageManager.GET_META_DATA)
        val parser = info.loadXmlMetaData(pm, "android.provider.CONTACTS_STRUCTURE")!!
        parser.use {
            while (it.eventType != org.xmlpull.v1.XmlPullParser.START_TAG) it.next()
            assertEquals("ContactsAccountType", it.name)
            while (it.next() != org.xmlpull.v1.XmlPullParser.START_TAG) { }
            assertEquals("ContactsDataKind", it.name)
            val ns = "http://schemas.android.com/apk/res/android"
            assertEquals(NativeSystemContacts.MIME, it.getAttributeValue(ns, "mimeType"))
            assertEquals("data2", it.getAttributeValue(ns, "summaryColumn"))
            assertEquals("data3", it.getAttributeValue(ns, "detailColumn"))
        }
        val auth = pm.getServiceInfo(ComponentName(context, VolnaContactsAuthenticatorService::class.java), android.content.pm.PackageManager.GET_META_DATA)
        assertEquals("android.permission.BIND_ACCOUNT_AUTHENTICATOR", auth.permission)
    }
    @Test fun contactActionIsResolvableAndRejectsOtherProvidersAndMalformedUris() {
        val matches = context.packageManager.queryIntentActivities(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://com.android.contacts/data/123"), NativeSystemContacts.MIME), 0)
        assertTrue(matches.any { it.activityInfo.name.endsWith("VolnaContactActionActivity") })
        assertTrue(NativeSystemContacts.isDataUri(Uri.parse("content://com.android.contacts/data/123")))
        for (value in listOf("content://evil/data/123", "file://com.android.contacts/data/123", "content://com.android.contacts/data/-1", "content://com.android.contacts/contacts/123", "content://com.android.contacts/data/123/extra"))
            assertFalse(value, NativeSystemContacts.isDataUri(Uri.parse(value)))
    }

    class BookProvider : ContentProvider() {
        val raw = linkedMapOf<Long, ContentValues>()
        val data = linkedMapOf<Long, ContentValues>()
        val links = mutableListOf<Pair<Long, Long>>()
        var writes = 0
        var foreignWrites = 0
        private var next = 100L
        override fun onCreate() = true
        override fun getType(uri: Uri) = NativeSystemContacts.MIME
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
            val fields = projection!!
            val result = MatrixCursor(fields)
            if (uri.pathSegments.first() == "phones" || uri.toString().contains("data/phones")) {
                result.addRow(arrayOf<Any>(1L, "+7 (999) 123-45-67", "Мама", 50L))
                result.addRow(arrayOf<Any>(2L, "+7 (999) 123-45-67", "Мама", 50L))
            } else {
                for ((id, row) in raw) {
                    if (args != null && row.getAsString(C.RawContacts.ACCOUNT_TYPE) != args[0]) continue
                    if (args != null && args.size > 1 && row.getAsString(C.RawContacts.ACCOUNT_NAME) != args[1]) continue
                    result.addRow(fields.map { if (it == C.RawContacts._ID) id else row[it] }.toTypedArray())
                }
            }
            return result
        }
        override fun insert(uri: Uri, values: ContentValues?): Uri {
            writes++
            val id = next++
            if (uri.pathSegments.first() == "raw_contacts") raw[id] = ContentValues(values) else data[id] = ContentValues(values)
            return ContentUris.withAppendedId(uri, id)
        }
        override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int {
            writes++
            if (uri.pathSegments.first() == "aggregation_exceptions") {
                val own = values!!.getAsLong(C.AggregationExceptions.RAW_CONTACT_ID1)
                assertTrue(raw.containsKey(own))
                links.add(own to values.getAsLong(C.AggregationExceptions.RAW_CONTACT_ID2))
            } else foreignWrites++
            return 1
        }
        override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int {
            writes++
            assertEquals("true", uri.getQueryParameter(C.CALLER_IS_SYNCADAPTER))
            val ids = if (selection!!.startsWith(C.RawContacts._ID + "=")) {
                val id = args!![0].toLong()
                assertEquals(NativeSystemContacts.TYPE, args[1])
                if (raw[id]?.getAsString(C.RawContacts.ACCOUNT_NAME) == args[2]) listOf(id) else emptyList()
            } else raw.filterValues { it.getAsString(C.RawContacts.ACCOUNT_TYPE) == args!![0] && it.getAsString(C.RawContacts.ACCOUNT_NAME) == args[1] }.keys.toList()
            ids.forEach { id -> raw.remove(id); data.entries.removeAll { it.value.getAsLong(C.Data.RAW_CONTACT_ID) == id } }
            return ids.size
        }
    }
}
