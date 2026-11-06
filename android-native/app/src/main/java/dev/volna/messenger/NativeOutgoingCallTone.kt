package dev.volna.messenger
internal fun nativeOutgoingCallTone(incoming:Boolean,status:String,received:Boolean,connected:Boolean):String =
    if(connected||incoming&&status=="ringing") "" else when(status){"preparing"->"setup";"ringing"->if(received)"ringback" else "setup";"connecting","active"->"setup";else->""}
