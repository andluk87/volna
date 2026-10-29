package dev.volna.messenger

/** The closure must retain the same command body/idempotency key across attempts. */
internal fun <T> nativeRetryCallMutation(action: () -> T): T = try { action() } catch (problem: Exception) {
    if(Thread.currentThread().isInterrupted || !(problem is java.io.IOException || problem is NativeApiException && problem.status >= 500)) throw problem
    action()
}
