package zw.co.omega.gateway.geofence

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Pure geofence logic, the Kotlin twin of src/lib/geofence.ts on the server. No Android types,
 * so it is unit-tested on the JVM. Works entirely offline: the site, radius and policy are cached
 * on the phone before the shift.
 */
object Geo {
    private const val EARTH_RADIUS_M = 6_371_000.0

    fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }
}

enum class LocState { INSIDE, OUTSIDE, UNKNOWN }

data class Site(val id: String, val name: String, val latitude: Double, val longitude: Double, val radiusM: Int)
data class Policy(val checkMinutes: Int = 10, val verifySeconds: Int = 60, val outsideCheckMinutes: Int = 3, val accuracyMaxM: Int = 100)

data class Classification(val state: LocState, val distanceM: Double, val reason: String? = null)

/** Accuracy-aware classification: decide only when the fence is outside the accuracy circle. */
fun classify(lat: Double, lon: Double, accuracyM: Float?, site: Site, accuracyMaxM: Int): Classification {
    val d = Geo.haversineM(lat, lon, site.latitude, site.longitude)
    val acc = (accuracyM ?: 0f).toDouble()
    if (acc > accuracyMaxM) return Classification(LocState.UNKNOWN, d, "poor_accuracy")
    if (d + acc <= site.radiusM) return Classification(LocState.INSIDE, d)
    if (d - acc > site.radiusM) return Classification(LocState.OUTSIDE, d)
    return Classification(LocState.UNKNOWN, d, "on_boundary")
}

enum class Phase { NOT_ON_SHIFT, WAITING_FOR_SHIFT, MONITORING, VERIFYING_OUTSIDE, OUTSIDE, LOCATION_UNAVAILABLE }

data class MonitorState(val phase: Phase = Phase.NOT_ON_SHIFT, val since: Long = 0, val outsideSince: Long? = null, val lastOutsideUpdate: Long? = null, val lastInsideCheck: Long? = null)

data class Observation(val at: Long, val state: LocState, val distanceM: Double? = null, val reason: String? = null)

data class Emitted(val type: String, val at: Long, val state: LocState, val distanceM: Double? = null, val reason: String? = null, val durationOutsideSeconds: Int? = null)

data class Step(val next: MonitorState, val events: List<Emitted>, val nextCheckSeconds: Int)

/** Same transitions as the server's stepMonitor(). */
fun stepMonitor(s: MonitorState, o: Observation, p: Policy): Step {
    val normal = p.checkMinutes * 60
    val outsideEvery = p.outsideCheckMinutes * 60
    val ev = mutableListOf<Emitted>()
    return when (o.state) {
        LocState.UNKNOWN -> {
            if (s.phase == Phase.OUTSIDE) {
                ev += Emitted("LOCATION_UNAVAILABLE", o.at, LocState.UNKNOWN, reason = o.reason ?: "no_fix")
                Step(s, ev, outsideEvery)
            } else {
                if (s.phase != Phase.LOCATION_UNAVAILABLE) ev += Emitted("LOCATION_UNAVAILABLE", o.at, LocState.UNKNOWN, reason = o.reason ?: "no_fix")
                Step(s.copy(phase = Phase.LOCATION_UNAVAILABLE, since = if (s.phase == Phase.LOCATION_UNAVAILABLE) s.since else o.at), ev, minOf(normal, 5 * 60))
            }
        }
        LocState.INSIDE -> {
            if (s.phase == Phase.OUTSIDE) {
                ev += Emitted("LOCATION_RETURNED", o.at, LocState.INSIDE, o.distanceM, durationOutsideSeconds = ((o.at - (s.outsideSince ?: o.at)) / 1000).toInt())
                Step(MonitorState(Phase.MONITORING, o.at, null, null, o.at), ev, normal)
            } else {
                ev += Emitted("LOCATION_CHECK", o.at, LocState.INSIDE, o.distanceM)
                Step(MonitorState(Phase.MONITORING, if (s.phase == Phase.MONITORING) s.since else o.at, null, null, o.at), ev, normal)
            }
        }
        LocState.OUTSIDE -> when (s.phase) {
            Phase.OUTSIDE -> {
                val due = s.lastOutsideUpdate == null || o.at - s.lastOutsideUpdate >= outsideEvery * 1000L - 1000
                if (due) ev += Emitted("LOCATION_OUTSIDE", o.at, LocState.OUTSIDE, o.distanceM)
                Step(s.copy(lastOutsideUpdate = if (due) o.at else s.lastOutsideUpdate), ev, outsideEvery)
            }
            Phase.VERIFYING_OUTSIDE -> {
                if (o.at - s.since >= p.verifySeconds * 1000L - 1000) {
                    ev += Emitted("LOCATION_EXIT", o.at, LocState.OUTSIDE, o.distanceM)
                    Step(MonitorState(Phase.OUTSIDE, o.at, s.since, o.at, s.lastInsideCheck), ev, outsideEvery)
                } else Step(s, ev, p.verifySeconds)
            }
            else -> Step(MonitorState(Phase.VERIFYING_OUTSIDE, o.at, null, null, s.lastInsideCheck), ev, p.verifySeconds)
        }
    }
}
