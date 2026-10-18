package zw.co.omega.gateway.service

/**
 * Pure rules of the automatic sync engine: what triggers it, how events are prioritised, how
 * retries back off, and what each server acknowledgement means for a queued row. No Android
 * types, unit-tested on the JVM (SyncPlannerTest).
 */
enum class Trigger { ACTIVATION, APP_START, NETWORK_RESTORED, CONFIG_CHANGED, NEW_EVENT, EMERGENCY, SCHEDULED, MANUAL, RETRY, WORKER }

/** Outbox row status. SYNCED rows are deleted (the server keeps the record), so they never appear here. */
enum class OutboxStatus { QUEUED, SENDING, RETRY_PENDING, FAILED }

object Priority {
    const val NORMAL = 0
    const val HIGH = 1
    const val EMERGENCY = 2

    /** Exits, returns, shift start and calls go first; routine checks after. Emergency is reserved for the Phase 2 module. */
    fun forEventType(type: String): Int = when (type) {
        "EMERGENCY", "PANIC", "EMERGENCY_ALERT" -> EMERGENCY
        "LOCATION_EXIT", "LOCATION_RETURNED", "SHIFT_STARTED", "CALL_STARTED", "CALL_ANSWERED", "CALL_ENDED", "CALL_MISSED", "LOCATION_CALL" -> HIGH
        else -> NORMAL
    }
}

enum class AckOutcome { ACKED, FAILED_PERMANENT, UNKNOWN }

object SyncPlanner {
    const val MAX_ATTEMPTS = 500

    /** 5 s · 15 s · 45 s · 2¼ min · … capped at 15 min; emergency rows never wait more than 60 s. */
    fun backoffMs(attempts: Int, priority: Int = Priority.NORMAL, baseMs: Long = 5_000L, maxMs: Long = 15 * 60_000L): Long {
        var ms = baseMs
        repeat((attempts - 1).coerceAtLeast(0).coerceAtMost(12)) { ms *= 3 }
        val cap = if (priority >= Priority.EMERGENCY) 60_000L else maxMs
        return ms.coerceAtMost(cap)
    }

    fun nextAttemptAt(nowMs: Long, attempts: Int, priority: Int = Priority.NORMAL): Long = nowMs + backoffMs(attempts, priority)

    /** "ok" and "duplicate" both mean the server has it. "rejected" is malformed and will never be accepted. */
    fun ackOutcome(status: String?): AckOutcome = when (status) {
        "ok", "duplicate" -> AckOutcome.ACKED
        "rejected" -> AckOutcome.FAILED_PERMANENT
        else -> AckOutcome.UNKNOWN
    }

    /** Give up only after an absurd number of attempts; durable means durable. */
    fun shouldFail(attempts: Int): Boolean = attempts >= MAX_ATTEMPTS

    /** Is a row due? FAILED never; SENDING only if a previous run died mid-send (older than the stale window). */
    fun isDue(status: OutboxStatus, nextAttemptAtMs: Long, nowMs: Long, sendingSinceMs: Long?, staleSendingMs: Long = 5 * 60_000L): Boolean = when (status) {
        OutboxStatus.FAILED -> false
        OutboxStatus.SENDING -> sendingSinceMs != null && nowMs - sendingSinceMs > staleSendingMs
        OutboxStatus.QUEUED, OutboxStatus.RETRY_PENDING -> nextAttemptAtMs <= nowMs
    }

    /** Device-side view for the dashboard: what the sync state should read. */
    fun syncState(online: Boolean, authRejected: Boolean, queued: Int, retryPending: Int, failed: Int, syncing: Boolean): String = when {
        authRejected -> "REVOKED"
        syncing -> "SENDING"
        !online && queued + retryPending > 0 -> "QUEUED_OFFLINE"
        retryPending > 0 -> "RETRY_PENDING"
        queued > 0 -> "QUEUED"
        failed > 0 -> "SYNCED_WITH_FAILURES"
        else -> "SYNCED"
    }
}
