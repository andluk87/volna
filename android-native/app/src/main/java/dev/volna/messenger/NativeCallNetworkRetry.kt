package dev.volna.messenger

import android.os.SystemClock
import kotlinx.coroutines.*

/** Only transport/server outages are retried; authentication and call ownership errors stay final. */
internal suspend fun <T> nativeCallNetworkRetry(valid:()->Boolean,waiting:()->Unit={},now:()->Long={SystemClock.elapsedRealtime()},pause:suspend(Long)->Unit={delay(it)},action:suspend()->T):T {
    val started=now()
    while(true){
        currentCoroutineContext().ensureActive();if(!valid())throw CancellationException("Звонок отменён")
        try{return action()}catch(cancelled:CancellationException){throw cancelled}catch(problem:Exception){
            val transient=problem is java.io.IOException||problem is NativeApiException&&problem.status in listOf(502,503,504)
            if(!transient||now()-started>=180000)throw problem
            waiting();pause(1000)
        }
    }
}
