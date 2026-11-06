package dev.volna.messenger
internal fun nativeOutgoingCallTone(incoming:Boolean,status:String,received:Boolean,connected:Boolean,established:Boolean=false):String =
    if(connected||established||incoming&&status=="ringing") "" else when(status){"preparing"->"setup";"ringing"->if(received)"ringback" else "setup";"connecting","active"->"setup";else->""}
