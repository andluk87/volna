package dev.volna.messenger

/** Fast only while negotiating; stable conversations and idle devices keep normal heartbeats. */
internal fun nativeCallPollDelay(hasCall:Boolean,connected:Boolean,reconnecting:Boolean):Long =
    if(hasCall&&(!connected||reconnecting))500L else 2000L
