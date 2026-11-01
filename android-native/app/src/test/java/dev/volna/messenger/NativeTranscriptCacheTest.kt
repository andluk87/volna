package dev.volna.messenger
import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],application=Application::class)
class NativeTranscriptCacheTest {
 @Test fun upgradeRemovesOnlyTranscriptAndNewWritesNeverPersistIt(){
  val context=RuntimeEnvironment.getApplication() as Context;context.deleteDatabase("volna-cache.db")
  val original=VolnaMessage(1,1,"Автор","Оригинальный текст","2026-11-01T12:00:00Z",false,null,chatId=9,transcript="Личная расшифровка")
  val old=NativeCodec.message(original).put("transcript","Личная расшифровка")
  SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("volna-cache.db"),null).use { db ->
   db.execSQL("CREATE TABLE snapshots(account INTEGER NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,touched INTEGER NOT NULL,PRIMARY KEY(account,key))")
   db.execSQL("INSERT INTO snapshots VALUES(?,?,?,?)",arrayOf<Any>(1,"messages-9",JSONArray().put(old).toString(),1));db.version=1
  }
  NativeCache(context).use { cache ->
   val row=cache.messages(1,9).single();assertEquals(original.text,row.text);assertNull(row.transcript)
   cache.saveMessages(1,9,listOf(original))
   cache.readableDatabase.rawQuery("SELECT value FROM snapshots WHERE account=1 AND key='messages-9'",null).use { cursor -> assertTrue(cursor.moveToFirst());assertFalse(cursor.getString(0).contains("transcript"));assertFalse(cursor.getString(0).contains("Личная расшифровка")) }
  };context.deleteDatabase("volna-cache.db")
 }
}
