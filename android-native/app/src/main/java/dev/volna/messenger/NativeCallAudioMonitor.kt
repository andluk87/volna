package dev.volna.messenger

/** Missing RTP can also mean mute/DTX: report evidence, never hang up on silence. */
internal class NativeCallAudioMonitor(private val started:Long,private val stallMs:Long=20000){
 private var previous:Long?=null
 private var progress=started
 private var seen=false
 val received:Boolean get()=seen
 private var stalled=false
 fun observe(packets:Long?,now:Long):Pair<String,Long?>?{
  if(packets==null||packets<0)return null
  val before=previous;previous=packets
  if(packets>0&&!seen){seen=true;progress=now;return "audio_first_packet" to maxOf(0L,now-started)}
  if(before!=null&&packets<before){progress=now;return null}
  if(before==null||packets!=before){progress=now;if(stalled){stalled=false;return "audio_resumed" to null};return null}
  if(seen&&!stalled&&now-progress>=stallMs){stalled=true;return "audio_stalled" to now-progress}
  return null
 }
}
