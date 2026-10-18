package zw.co.omega.gateway.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns the GPS monitoring loop and nothing else. Exactly one location check runs at a time.
 *
 * Rules that fix the defects seen on the Pixel:
 * - A manual "check now" never cancels a check in progress; it joins it, and if it arrives
 *   mid-check the loop runs one more check straight after, so the tap is never lost.
 * - A new shift config (first download, site moved, shift changed) wakes the loop at once
 *   instead of waiting out a 15-minute sleep.
 * - CancellationException is only thrown when the service stops; it is re-thrown, never logged
 *   as a failed step.
 * - Any other exception in a step is logged and the loop keeps going with a short wait.
 *
 * No Android types: `stepper` is injected, so the loop is unit-tested on the JVM.
 */
class MonitoringCoordinator(
    private val scope: CoroutineScope,
    private val stepper: suspend () -> StepOutcome?,
    private val isGuardMode: () -> Boolean,
    private val configChanges: Flow<Long>? = null,
    private val onAfterStep: (StepOutcome?) -> Unit = {},
    private val log: (String) -> Unit = {},
    private val minWaitMs: Long = 30_000L,
    private val maxWaitMs: Long = 15 * 60_000L,
    private val noConfigWaitMs: Long = 60_000L,
    private val notGuardWaitMs: Long = 15 * 60_000L,
) {
    /** What one step tells the loop. `nextCheckSeconds` ≤ 0 means "no shift config yet". */
    data class StepOutcome(val nextCheckSeconds: Int, val producedEvents: Boolean = false, val onShift: Boolean = true)

    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val pending = AtomicBoolean(false)
    private val _checking = MutableStateFlow(false)
    val checking: StateFlow<Boolean> get() = _checking
    private var loop: Job? = null
    private var watcher: Job? = null
    @Volatile var stepsRun: Int = 0
        private set

    /** Idempotent. */
    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { run() }
        if (configChanges != null && watcher?.isActive != true) watcher = scope.launch { configChanges.drop(1).collect { onConfigChanged() } }
    }

    fun stop() { loop?.cancel(); watcher?.cancel(); loop = null; watcher = null }

    /**
     * Ask for a check now. Returns true when a new check will start immediately, false when one is
     * already running (the request is remembered and a fresh check follows it).
     */
    fun requestCheck(): Boolean {
        if (_checking.value) { pending.set(true); return false }
        wake.trySend(Unit)
        return true
    }

    /** The cached shift/site/policy changed: re-evaluate right away (after the current check, if any). */
    fun onConfigChanged() { if (_checking.value) pending.set(true) else wake.trySend(Unit) }

    private suspend fun run() {
        while (scope.isActive) {
            if (!isGuardMode()) { await(notGuardWaitMs); continue }
            val r = runStep()
            onAfterStep(r)
            if (pending.getAndSet(false)) continue
            val wait = when { r == null -> minWaitMs; r.nextCheckSeconds <= 0 -> noConfigWaitMs; else -> (r.nextCheckSeconds * 1000L).coerceIn(minWaitMs, maxWaitMs) }
            await(wait)
        }
    }

    private suspend fun runStep(): StepOutcome? {
        _checking.value = true
        stepsRun++
        return try { stepper() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { log("monitor step failed: ${e.javaClass.simpleName}: ${e.message}"); null }
        finally { _checking.value = false }
    }

    private suspend fun await(ms: Long) { withTimeoutOrNull(ms) { wake.receive() } }
}
