package dev.volna.messenger
/** Caller UI uses the contact's name, never a username or synthetic telephone number. */
internal fun nativeCallerName(custom:String,phonebook:String,profile:String):String =
    listOf(custom,phonebook,profile).firstOrNull{it.isNotBlank()}?.trim()?:"Собеседник"
