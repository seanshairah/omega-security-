package zw.co.omega.gateway.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicReference

/**
 * Owns the automatic sync loop and nothing else. Independent of GPS monitoring: it never touches
 * location state and is never cancelled by a location check.
 *
 * - One sync run at a time. A request that arrives mid-run is remembered (highest-priority
 *   trigger wins) and a fresh run follows immediately, so no trigger is lost.
 * - Wakes on: explicit triggers (activation, app start, network back, config change, new event,
 *   emergency, manual, WorkManager), the earliest retry time of a queued row, and a periodic tick.
 * - CancellationException is re-thrown (service stopping); other exceptions are logged and the loop
 *   continues after the periodic wait.
 *
 * No Android types: `runner` is injected, so the loop is unit-tested on the JVM.
 */
class SyncCoordinator(
    private val scope: CoroutineScope,
    private val runner: suspend (Trigger) -> Result?,
    private val nextRetryAtMs: () -> Long? = { null },
    private val now: () -> Long = System::currentTimeMillis,
    private val periodMs: Long = 5 * 60_000L,
    private val minWaitMs: Long = 2_000L,
    private val log: (String) -> Unit = {},
) {
    data class Result(val sent: Int, val acked: Int, val failed: Int, val retryPending: Int, val error: String?)

    private val wake = Channel<Trigger>(Channel.CONFLATED)
    private val pending = AtomicReference<Trigger?>(null)
    private val _syncing = MutableStateFlow(false)
    val syncing: StateFlow<Boolean> get() = _syncing
    private var loop: Job? = null
    @Volatile var runs: Int = 0
        private set
    @Volatile var lastTrigger: Trigger? = null
        private set

    fun start() { if (loop?.isActive != true) loop = scope.launch { run() } }
    fun stop() { loop?.cancel(); loop = null }

    /** Returns true when a run starts now, false when one is running and this trigger is queued behind it. */
    fun request(trigger: Trigger): Boolean {
        if (_syncing.value) { pending.updateAndGet { p -> if (p == null || trigger.ordinal > p.ordinal) trigger else p }; return false }
        wake.trySend(trigger)
        return true
    }

    private suspend fun run() {
        var next: Trigger? = Trigger.APP_START
        while (scope.isActive) {
            val trigger = next ?: await()
            next = null
            runOnce(trigger)
            next = pending.getAndSet(null)
        }
    }

    private suspend fun runOnce(trigger: Trigger) {
        _syncing.value = true
        runs++
        lastTrigger = trigger
        try { runner(trigger) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { log("sync run failed: ${e.javaClass.simpleName}: ${e.message}") }
        finally { _syncing.value = false }
    }

    private suspend fun await(): Trigger {
        val retryIn = nextRetryAtMs()?.let { (it - now()).coerceAtLeast(minWaitMs) }
        val wait = minOf(periodMs, retryIn ?: periodMs)
        return withTimeoutOrNull(wait) { wake.receive() } ?: if (retryIn != null && retryIn <= periodMs) Trigger.RETRY else Trigger.SCHEDULED
    }
}
