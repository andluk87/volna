package dev.volna.messenger

import android.app.Application
import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NativeIncomingShareTest {
    @Test fun androidResolvesTextAndMultipleFilesToTheMainActivity() {
        val context = RuntimeEnvironment.getApplication()
        for (action in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) for (mime in listOf("text/plain", "image/jpeg", "video/mp4", "application/pdf")) {
            val matches = context.packageManager.queryIntentActivities(Intent(action).setType(mime).addCategory(Intent.CATEGORY_DEFAULT), 0)
            assertTrue("$action $mime", matches.any { it.activityInfo.name.endsWith("MainActivity") && it.activityInfo.exported })
        }
    }
    @Test fun sharedLinksAndSubjectsArePreservedWithoutDuplicateTitles() {
        val plain = NativeIncomingShare.parse(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.org/page"))!!
        assertEquals("https://example.org/page", plain.text); assertTrue(plain.uris.isEmpty()); assertEquals("", plain.error)
        val titled = NativeIncomingShare.parse(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, "Статья").putExtra(Intent.EXTRA_TEXT, "https://example.org"))!!
        assertEquals("Статья\nhttps://example.org", titled.text)
        val duplicate = NativeIncomingShare.parse(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, "Статья").putExtra(Intent.EXTRA_TEXT, "Статья\nhttps://example.org"))!!
        assertEquals(titled.text, duplicate.text)
        assertNull(NativeIncomingShare.parse(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.org"))))
    }
    @Test fun streamsAndClipDataAreCombinedAndDeduplicated() {
        val first = Uri.parse("content://fixture/a"); val second = Uri.parse("content://fixture/b")
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first, second))
        intent.clipData = ClipData.newRawUri("shared", first)
        val value = NativeIncomingShare.parse(intent)!!
        assertEquals(listOf(first, second), value.uris); assertEquals("", value.error)
    }
    @Test fun oversizedBatchesAndUntrustedFilePathsAreRejectedBeforeOpeningStreams() {
        val batch = Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList((0..10).map { Uri.parse("content://fixture/$it") }))
        assertTrue(NativeIncomingShare.parse(batch)!!.error.contains("10"))
        assertTrue(NativeIncomingShare.parse(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///private/secret")))!!.error.isNotBlank())
        assertTrue(NativeIncomingShare.parse(Intent(Intent.ACTION_SEND))!!.error.isNotBlank())
    }
    @Test fun sharedFilesAreCopiedLocallyWithSafeNamesBeforeProviderPermissionExpires() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val source = File(context.cacheDir, "provider-original.txt").apply { writeText("Текст из другого приложения") }
        val provider = object : ContentProvider() {
            override fun onCreate() = true
            override fun getType(uri: Uri) = "text/plain"
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
                MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply { addRow(arrayOf<Any>("../example.txt", source.length())) }
            override fun openFile(uri: Uri, mode: String) = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY)
            override fun insert(uri: Uri, values: ContentValues?): Uri? = null
            override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
            override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        }
        provider.attachInfo(context, android.content.pm.ProviderInfo().apply { authority = "sharefixture" })
        ShadowContentResolver.registerProviderInternal("sharefixture", provider)
        val share = NativeIncomingShare.parse(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, Uri.parse("content://sharefixture/file")))!!
        val prepared = prepareIncomingShare(context, share)
        try {
            val file = File(prepared.files.single().uri.path!!)
            assertEquals(prepared.directory!!.canonicalFile, file.canonicalFile.parentFile)
            assertEquals("text/plain", prepared.files.single().mime)
            source.delete() // The sender can revoke access now; preview/send use our private copy.
            assertEquals("Текст из другого приложения", file.readText())
        } finally { prepared.directory?.deleteRecursively() }
    }
}
