package dev.volna.messenger
/** Only a phone already disclosed by the server can become a telephone identity. */
internal fun nativeCallerAddress(phone:String,username:String,id:Long):String {
 val normalized=phone.filter{it.isDigit()||it=='+'}
 return if(Regex("[+0-9() -]+").matches(phone)&&Regex("\\+?[0-9]{7,15}").matches(normalized))"tel:$normalized" else "sip:${username.takeIf{Regex("[a-zA-Z0-9_]{4,32}").matches(it)}?:"user$id"}@volna.local"
}
