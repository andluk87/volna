package dev.volna.messenger

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import android.util.Base64

/** Restore before upload; retry offline without replacing a saved profile with defaults. */
@Composable
internal fun NativeCloudAppearance(account: Long, token: String, api: NativeApi, restored: () -> Unit): String {
    var failure by remember(account){mutableStateOf("")}
    val context=LocalContext.current
    val latestRestored by rememberUpdatedState(restored)
    LaunchedEffect(account,token) {
        if(account<=0 || token.isBlank())return@LaunchedEffect
        val appearance=context.getSharedPreferences("volna-appearance-$account",0)
        val themes=context.getSharedPreferences("volna-themes-$account",0)
        if(appearance.all.isEmpty()) {
            val legacy=context.getSharedPreferences("volna-appearance",0)
            if(legacy.all.isNotEmpty())restorePrefs(appearance,typedPrefs(legacy))
        }
        val sync=context.getSharedPreferences("volna-appearance-sync-$account",0)
        var initialized=false;var previous="";var localSignature=""
        while(true) {
            try {
                if(!initialized) {
                    val remote=withContext(Dispatchers.IO){api.contactRequest("/me/appearance/android",token).optJSONObject("settings")}
                    val savedSignature=sync.getString("signature",null)
                    val pending=savedSignature!=null&&savedSignature!=typedPrefs(appearance).toString()+typedPrefs(themes).toString()
                    if(remote!=null&&!pending) {
                        withContext(Dispatchers.IO){restoreImages(context,remote.optJSONObject("images"));restorePrefs(appearance,remote.optJSONObject("appearance"));restorePrefs(themes,remote.optJSONObject("themes"))}
                        latestRestored()
                        previous=remote.toString()
                    }
                    initialized=true
                }
                val signature=typedPrefs(appearance).toString()+typedPrefs(themes).toString()
                if(signature!=localSignature) {
                    val value=withContext(Dispatchers.IO){snapshot(context,appearance,themes)}
                    if(value.toString()!=previous) {
                    withContext(Dispatchers.IO){api.contactRequest("/me/appearance/android",token,JSONObject().put("settings",value))}
                    previous=value.toString()
                    }
                    localSignature=signature
                    sync.edit().putString("signature",signature).apply()
                    failure=""
                }
            } catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled} catch(problem:Exception) { failure=problem.message?:"Не удалось сохранить оформление" }
            delay(2000)
        }
    }
    return failure
}
private fun typedPrefs(prefs: SharedPreferences): JSONObject = JSONObject().also { out ->
    prefs.all.toSortedMap().forEach { (key,value) ->
        val type=when(value){is String->"string";is Boolean->"boolean";is Int->"int";is Long->"long";is Float->"float";else->null}
        if(type!=null)out.put(key,JSONObject().put("type",type).put("value",value))
    }
}
private fun restorePrefs(prefs:SharedPreferences,data:JSONObject?) {
    if(data==null)return
    val editor=prefs.edit().clear()
    data.keys().forEach { key -> val row=data.getJSONObject(key);when(row.getString("type")) {
        "string"->editor.putString(key,row.getString("value"));"boolean"->editor.putBoolean(key,row.getBoolean("value"))
        "int"->editor.putInt(key,row.getInt("value"));"long"->editor.putLong(key,row.getLong("value"));"float"->editor.putFloat(key,row.getDouble("value").toFloat())
    }}
    editor.commit()
}
private fun snapshot(context:Context,appearance:SharedPreferences,themes:SharedPreferences):JSONObject {
    val a=typedPrefs(appearance);val t=typedPrefs(themes);val images=JSONObject()
    val source=a.toString()+t.toString()
    File(context.filesDir,"theme-wallpapers").listFiles()?.sortedBy{it.name}?.forEach { file ->
        if(source.contains(file.name)) { require(file.length()<=5*1024*1024){"Обои для облачного профиля: не более 5 МБ"};images.put(file.name,Base64.encodeToString(file.readBytes(),Base64.NO_WRAP)) }
    }
    return JSONObject().put("appearance",a).put("themes",t).put("images",images)
}
private fun restoreImages(context:Context,images:JSONObject?) {
    if(images==null)return
    val directory=File(context.filesDir,"theme-wallpapers").apply{mkdirs()}
    images.keys().forEach { name ->
        require(Regex("[a-zA-Z0-9-]+\\.(jpg|png|webp)").matches(name))
        val bytes=Base64.decode(images.getString(name),Base64.DEFAULT);require(bytes.size<=5*1024*1024)
        File(directory,name).writeBytes(bytes)
    }
}
