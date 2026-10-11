package dev.volna.messenger
internal fun nativeOutgoingCallTone(incoming:Boolean,status:String,received:Boolean,connected:Boolean):String =
    if(incoming||connected) "" else when(status){"preparing"->"setup";"ringing"->if(received)"ringback" else "setup";else->""}
