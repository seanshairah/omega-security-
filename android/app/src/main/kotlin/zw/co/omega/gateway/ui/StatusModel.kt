package zw.co.omega.gateway.ui

/**
 * Turns the raw monitoring facts into the three independent things the dashboard shows:
 * shift state, GPS state (with the reason when it is unknown) and sync state. Pure, unit-tested.
 *
 * Why three: "device offline" (no internet), "GPS unavailable" (no usable fix) and
 * "outside site" (a verified reading) used to collapse into one line, and "turn on location"
 * was printed for every unknown reason, including poor accuracy with location switched on.
 */
enum class ShiftView { NONE, UPCOMING, ACTIVE }

enum class GpsView { OFF, CHECKING, INSIDE, OUTSIDE_VERIFYING, OUTSIDE, UNKNOWN }

/** What to tell the guard about an UNKNOWN reading. Mapped 1:1 from the reason the classifier stored. */
enum class GpsReasonKind { NONE, NO_FIX, POOR_ACCURACY, LOCATION_OFF, PERMISSION, SITE_NO_COORDINATES, ON_BOUNDARY, NOT_CHECKED_YET }

enum class SyncView { REVOKED, NO_INTERNET, SENDING, RETRY_PENDING, QUEUED, SYNCED_WITH_FAILURES, SYNCED, WAITING }

data class StatusFacts(
    val shift: ShiftView,
    val checking: Boolean,
    /** Phase name from the state machine: MONITORING, VERIFYING_OUTSIDE, OUTSIDE, LOCATION_UNAVAILABLE, NOT_ON_SHIFT, WAITING_FOR_SHIFT */
    val phase: String,
    /** Reason stored with the last observation when it was UNKNOWN. */
    val reason: String?,
    val lastCheckAt: Long,
    val online: Boolean,
    val authRejected: Boolean,
    val queued: Int,
    val lastEventSyncAt: Long,
    val lastHeartbeatOk: Boolean,
    /** From SyncPlanner.syncState (the engine's own view); "" when unknown. */
    val syncState: String = "",
)

fun gpsView(f: StatusFacts): GpsView = when {
    f.shift != ShiftView.ACTIVE -> GpsView.OFF
    f.checking -> GpsView.CHECKING
    f.phase == "MONITORING" || f.phase == "INSIDE" -> GpsView.INSIDE
    f.phase == "VERIFYING_OUTSIDE" -> GpsView.OUTSIDE_VERIFYING
    f.phase == "OUTSIDE" -> GpsView.OUTSIDE
    else -> GpsView.UNKNOWN
}

fun gpsReasonKind(reason: String?, lastCheckAt: Long): GpsReasonKind = when (reason) {
    "no_fix" -> GpsReasonKind.NO_FIX
    "poor_accuracy" -> GpsReasonKind.POOR_ACCURACY
    "location_disabled" -> GpsReasonKind.LOCATION_OFF
    "permission_revoked" -> GpsReasonKind.PERMISSION
    "site_has_no_coordinates" -> GpsReasonKind.SITE_NO_COORDINATES
    "on_boundary" -> GpsReasonKind.ON_BOUNDARY
    null, "" -> if (lastCheckAt <= 0L) GpsReasonKind.NOT_CHECKED_YET else GpsReasonKind.NONE
    else -> GpsReasonKind.NO_FIX
}

fun syncView(f: StatusFacts): SyncView = when {
    f.authRejected -> SyncView.REVOKED
    !f.online && f.queued > 0 -> SyncView.NO_INTERNET
    f.syncState == "SENDING" -> SyncView.SENDING
    f.syncState == "RETRY_PENDING" && f.queued > 0 -> SyncView.RETRY_PENDING
    f.queued > 0 -> SyncView.QUEUED
    !f.online -> SyncView.NO_INTERNET
    f.syncState == "SYNCED_WITH_FAILURES" -> SyncView.SYNCED_WITH_FAILURES
    f.lastEventSyncAt > 0L || f.lastHeartbeatOk -> SyncView.SYNCED
    else -> SyncView.WAITING
}

/** "±121.4 m": one decimal so a 100.4 m fix is never shown as the 100 m limit it just failed. */
fun formatAccuracy(accuracyM: Float): String = "±" + String.format(java.util.Locale.US, "%.1f", accuracyM) + " m"

fun formatDistance(distanceM: Float): String = if (distanceM < 0f) "—" else "${Math.round(distanceM)} m"
