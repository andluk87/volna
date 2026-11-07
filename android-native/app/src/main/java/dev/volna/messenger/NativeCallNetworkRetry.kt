package dev.volna.messenger

import android.os.SystemClock
import kotlinx.coroutines.*

internal fun nativeCallRetryDelay(problem:NativeApiException):Long = if(problem.retryAt>0&&problem.serverTime>0)(problem.retryAt-problem.serverTime).coerceIn(1000L,300000L) else 60000L

/** Only transport/server outages are retried; authentication and call ownership errors stay final. */
internal suspend fun <T> nativeCallNetworkRetry(valid:()->Boolean,waiting:()->Unit={},now:()->Long={SystemClock.elapsedRealtime()},pause:suspend(Long)->Unit={delay(it)},action:suspend()->T):T {
    val started=now();var last:Exception?=null
    while(true){
        currentCoroutineContext().ensureActive();if(!valid())throw CancellationException("Звонок отменён")
        if(last!=null&&now()-started>=180000)throw last
        try{return action()}catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){
            val transient=problem is java.io.IOException||problem is NativeApiException&&problem.status in listOf(429,502,503,504)
            if(!transient||now()-started>=180000)throw problem
            last=problem;waiting();pause(minOf(if(problem is NativeApiException&&problem.status==429)nativeCallRetryDelay(problem) else 1000L,maxOf(0L,180000-(now()-started))))
        }
    }
}
