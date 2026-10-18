package zw.co.omega.gateway.location

import zw.co.omega.gateway.model.DeviceCommand

/**
 * Pure decisions for an operations location request (REQUEST_LOCATION). No Android types, so the
 * rules are unit-tested on the JVM.
 *
 * - A command is handled once: ids already answered are ignored however often they are redelivered.
 * - An expired command never starts the GPS; it is answered FAILED/REQUEST_EXPIRED so the server
 *   is not left waiting.
 * - A fix the shift monitor took moments ago may answer the request only when it is fresh enough
 *   and within the request's accuracy limit; otherwise a new acquisition runs, sharing the single
 *   acquisition lock with the monitor (never cancelling it).
 * - A fix worse than the limit is reported as POOR_ACCURACY with its coordinates, never as a good fix.
 */
object LocationRequestPolicy {
    /** How old a monitoring fix may be and still count as "fresh" for a request. */
    const val REUSE_MAX_AGE_MS = 30_000L
    /** Never let one request hold the GPS longer than this, even with a long deadline. */
    const val MAX_BUDGET_MS = 45_000L
    const val MIN_BUDGET_MS = 10_000L

    enum class Precheck { OK, EXPIRED, PERMISSION_DENIED, LOCATION_DISABLED }

    fun precheck(cmd: DeviceCommand, nowMs: Long, hasPermission: Boolean, providersEnabled: Boolean): Precheck = when {
        cmd.isExpiredAt(nowMs) -> Precheck.EXPIRED
        !hasPermission -> Precheck.PERMISSION_DENIED
        !providersEnabled -> Precheck.LOCATION_DISABLED
        else -> Precheck.OK
    }

    /** May a recent fix stand in for a new acquisition? */
    fun canReuse(cmd: DeviceCommand, fixAtMs: Long, fixAccuracyM: Float, nowMs: Long): Boolean =
        fixAtMs > 0L && nowMs - fixAtMs in 0..REUSE_MAX_AGE_MS && fixAccuracyM <= cmd.maxAccuracyM && (!cmd.requireFreshFix || nowMs - fixAtMs <= REUSE_MAX_AGE_MS)

    /** GPS time budget: what is left before the deadline, clamped so a short deadline still gets a fair try and a long one does not drain the battery. */
    fun budgetMs(cmd: DeviceCommand, nowMs: Long): Long = (cmd.expiresAtMs - nowMs).coerceIn(MIN_BUDGET_MS, MAX_BUDGET_MS)

    /** Acquisition policy for the request: stop early at 20 m, accept up to the request's limit. */
    fun acquisition(cmd: DeviceCommand, nowMs: Long) = AcquisitionPolicy(budgetMs = budgetMs(cmd, nowMs), goodEnoughM = minOf(20f, cmd.maxAccuracyM), acceptableM = cmd.maxAccuracyM, settleMs = 10_000L)

    sealed class Outcome {
        data class Completed(val latitude: Double, val longitude: Double, val accuracyM: Float, val provider: String, val capturedAtMs: Long, val mock: Boolean, val reused: Boolean) : Outcome()
        data class Failed(val reason: String, val detail: String?, val latitude: Double? = null, val longitude: Double? = null, val accuracyM: Float? = null, val capturedAtMs: Long? = null) : Outcome()
    }

    /** Judge an acquired fix (or none) against the request. */
    fun judge(cmd: DeviceCommand, fix: FixSummary?, lat: Double?, lng: Double?, provider: String?, mock: Boolean, reused: Boolean, backgroundRestricted: Boolean): Outcome {
        if (fix == null || lat == null || lng == null) return Outcome.Failed(if (backgroundRestricted) "SERVICE_RESTRICTED" else "GPS_TIMEOUT", if (backgroundRestricted) "no fix; app is background-restricted" else "no fix within ${budgetMs(cmd, System.currentTimeMillis()) / 1000} s")
        if (fix.accuracyM > cmd.maxAccuracyM) return Outcome.Failed("POOR_ACCURACY", "±${fix.accuracyM.toInt()} m, limit ${cmd.maxAccuracyM.toInt()} m", lat, lng, fix.accuracyM, fix.timeMs)
        return Outcome.Completed(lat, lng, fix.accuracyM, provider ?: fix.provider, fix.timeMs, mock, reused)
    }
}
