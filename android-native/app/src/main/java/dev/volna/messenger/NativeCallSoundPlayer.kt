package dev.volna.messenger

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri

internal fun nativeCallEndTone(reason:String,hadCall:Boolean=true):String = when(reason){
    "other_device","call_replaced","session_reset","component_unmount","abandoned_call","operation_cancelled" -> ""
    "call_busy","server_declined" -> "busy"
    "start_error","accept_error","answer_error","webrtc_unavailable","audio_error","audio_focus_lost","telecom_audio_lost","service_error","service_destroyed","uncaught_error","poll_timeout","connect_timeout","recovery_timeout","server_interrupted" -> "failed"
    else -> if(hadCall)"end" else ""
}

/** Looping call progress and short terminal effects have independent, releasable players. */
internal class NativeCallSoundPlayer(private val context:Context){
    private var loop:MediaPlayer?=null
    private var effect:MediaPlayer?=null
    private fun resource(kind:String)=when(kind){"ringback"->R.raw.voip_ringback;"setup"->R.raw.voip_connecting;"end"->R.raw.voip_end;"busy"->R.raw.voip_busy;"failed"->R.raw.voip_failed;else->0}
    fun loop(kind:String){stopLoop();stopEffect();play(kind,true)}
    fun effect(kind:String){stopEffect();if(kind.isNotEmpty())play(kind,false)}
    private fun play(kind:String,repeating:Boolean){
        val id=resource(kind);if(id==0)return
        val player=MediaPlayer()
        if(repeating)loop=player else effect=player
        fun release(){if(loop===player)loop=null;if(effect===player)effect=null;runCatching{player.release()}}
        try{
            player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            player.setDataSource(context,Uri.parse("android.resource://${context.packageName}/$id"))
            player.isLooping=repeating;player.setVolume(.5f,.5f)
            player.setOnPreparedListener{if((if(repeating)loop else effect)===it)runCatching{it.start()} else release()}
            var busyRepeats=2
            player.setOnCompletionListener{if(effect===it&&kind=="busy"&&busyRepeats-->0)runCatching{it.seekTo(0);it.start()}.onFailure{release()} else release()}
            player.setOnErrorListener{_,_,_->release();true}
            player.prepareAsync()
        }catch(_:Exception){release()}
    }
    fun stopLoop(){val old=loop;loop=null;runCatching{old?.release()}}
    private fun stopEffect(){val old=effect;effect=null;runCatching{old?.release()}}
    fun stop(){stopLoop();stopEffect()}
}
