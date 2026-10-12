package dev.volna.messenger
/** Caller UI uses the contact's name, never a username or synthetic telephone number. */
internal fun nativeCallerName(custom:String,phonebook:String,profile:String):String =
    listOf(custom,phonebook,profile).firstOrNull{it.isNotBlank()}?.trim()?:"Собеседник"

internal fun nativeKnownContactPhone(value:String):String? {
 if(!Regex("[+0-9() -]+").matches(value))return null
 val number=value.filter{it.isDigit()||it=='+'}
 return number.takeIf{Regex("\\+?[0-9]{7,15}").matches(it)}
}
