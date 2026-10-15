package zw.co.omega.gateway.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.geofence.*
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.util.DeviceInfo
import java.util.UUID
import kotlin.coroutines.resume

/**
 * Shift-aware location monitoring for guard devices. Runs inside the foreground service.
 *
 * - Uses the platform LocationManager (GPS first, network as fallback) so no Play Services are
 *   needed on old phones. One fix per check, never a stream.
 * - Classifies the fix locally against the cached site and radius, drives the pure state
 *   machine, and queues events to the same outbox as calls. Needs no internet at all.
 * - Reports LOCATION_UNAVAILABLE with a reason when it cannot see where the phone is.
 */
class LocationMonitor(private val context: Context) {
    private val prefs = Prefs(context)
    private val queue = EventQueue(context)
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    @Volatile var state = MonitorState()
        private set
    private var configShiftId: String? = null

    data class Result(val phase: Phase, val nextCheckSeconds: Int, val fix: Location?, val classification: Classification?)

    /** One monitoring step. Returns how long to wait before the next one. */
    suspend fun step(now: Long = System.currentTimeMillis()): Result {
        val cfg = ShiftConfig.load(context)
        if (cfg == null || !cfg.isActiveAt(now)) {
            val phase = if (cfg != null && cfg.isUpcomingAt(now)) Phase.WAITING_FOR_SHIFT else Phase.NOT_ON_SHIFT
            if (state.phase != phase) { state = MonitorState(phase, now); configShiftId = null }
            prefs.monitoringState = phase.name
            val wait = if (cfg != null && cfg.isUpcomingAt(now)) ((cfg.startAtMs - 10 * 60_000L - now) / 1000).toInt().coerceIn(60, 15 * 60) else 15 * 60
            return Result(phase, wait, null, null)
        }
        val fix = obtainFix(cfg.policy)
        val obs = observe(fix, cfg, now)
        val c = fix?.let { f -> cfg.site?.let { classify(f.latitude, f.longitude, f.accuracy, it, cfg.policy.accuracyMaxM) } }
        if (configShiftId != cfg.shiftId) {
            // New shift: announce monitoring with the first fix, then seed the state machine from it.
            configShiftId = cfg.shiftId
            state = MonitorState(Phase.MONITORING, now)
            enqueue("SHIFT_STARTED", obs, fix, cfg)
        }
        val r = stepMonitor(state, obs, cfg.policy)
        state = r.next
        for (e in r.events) enqueue(e.type, obs.copy(reason = e.reason ?: obs.reason), fix, cfg, e.durationOutsideSeconds)
        prefs.monitoringState = if (!DeviceInfo.isOnline(context) && state.phase == Phase.MONITORING) "OFFLINE_MONITORING" else state.phase.name
        return Result(state.phase, r.nextCheckSeconds, fix, c)
    }

    private fun observe(fix: Location?, cfg: ShiftConfig, now: Long): Observation {
        if (!hasLocationPermission()) return Observation(now, LocState.UNKNOWN, reason = "permission_revoked")
        if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER) && !lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) return Observation(now, LocState.UNKNOWN, reason = "location_disabled")
        if (fix == null) return Observation(now, LocState.UNKNOWN, reason = "no_fix")
        val site = cfg.site ?: return Observation(now, LocState.UNKNOWN, reason = "site_has_no_coordinates")
        val c = classify(fix.latitude, fix.longitude, fix.accuracy, site, cfg.policy.accuracyMaxM)
        return Observation(now, c.state, c.distanceM, c.reason)
    }

    private fun enqueue(type: String, o: Observation, fix: Location?, cfg: ShiftConfig, durationOutsideSeconds: Int? = null) {
        val mock = fix != null && isMock(fix)
        if (mock) prefs.mockSeen = true
        val extra = JSONObject().apply {
            fix?.let { put("latitude", it.latitude); put("longitude", it.longitude); put("accuracyM", it.accuracy.toDouble()); put("provider", it.provider ?: "unknown"); if (it.hasSpeed()) put("speed", it.speed.toDouble()); if (it.hasBearing()) put("bearing", it.bearing.toDouble()) }
            o.distanceM?.let { put("distanceM", Math.round(it).toDouble()) }
            cfg.site?.let { put("geofenceRadiusM", it.radiusM); put("siteId", it.id) }
            put("locationState", o.state.name); put("shiftId", cfg.shiftId); put("mock", mock)
            o.reason?.let { put("reason", it) }
            durationOutsideSeconds?.let { put("durationOutsideSeconds", it) }
            put("meta", JSONObject().put("phase", state.phase.name).put("online", DeviceInfo.isOnline(context)))
        }
        queue.enqueue(GatewayEvent(eventId = UUID.randomUUID().toString(), eventType = type, timestampMs = o.at, extra = extra))
        if (fix != null) { prefs.lastFixLat = fix.latitude; prefs.lastFixLng = fix.longitude; prefs.lastFixAccuracy = fix.accuracy; prefs.lastFixAt = o.at; prefs.lastFixState = o.state.name; prefs.lastFixDistanceM = (o.distanceM ?: -1.0).toFloat() }
        prefs.lastCheckAt = o.at
        Log.i(TAG, "queued $type ${o.state} ${o.distanceM?.let { "${it.toInt()} m" } ?: ""} ${o.reason ?: ""}")
    }

    /** The latest fix as the server expects it, for heartbeats and call events. */
    fun lastFixJson(): JSONObject? {
        if (prefs.lastFixAt <= 0L) return null
        return JSONObject().put("latitude", prefs.lastFixLat).put("longitude", prefs.lastFixLng).put("accuracyM", prefs.lastFixAccuracy.toDouble()).put("at", GatewayEvent.iso(prefs.lastFixAt)).put("locationState", prefs.lastFixState).put("state", prefs.lastFixState)
    }

    fun hasLocationPermission(): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** One fresh fix: GPS with a 45 s budget, then the network provider, then a last-known fix under two minutes old. */
    suspend fun obtainFix(policy: Policy): Location? {
        if (!hasLocationPermission()) return null
        val gps = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) requestOnce(LocationManager.GPS_PROVIDER, 45_000) else null
        if (gps != null && gps.accuracy <= policy.accuracyMaxM) return gps
        val net = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) requestOnce(LocationManager.NETWORK_PROVIDER, 20_000) else null
        val best = listOfNotNull(gps, net).minByOrNull { it.accuracy }
        if (best != null) return best
        return try { listOfNotNull(lm.getLastKnownLocation(LocationManager.GPS_PROVIDER), lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)).filter { System.currentTimeMillis() - it.time < 120_000 }.minByOrNull { it.accuracy } } catch (e: SecurityException) { null }
    }

    private suspend fun requestOnce(provider: String, timeoutMs: Long): Location? = withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine { cont ->
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) { if (cont.isActive) cont.resume(location) }
                @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) { if (cont.isActive) cont.resume(null) }
            }
            try {
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            } catch (e: Exception) { Log.w(TAG, "requestSingleUpdate $provider: ${e.message}"); if (cont.isActive) cont.resume(null) }
            cont.invokeOnCancellation { Handler(Looper.getMainLooper()).post { runCatching { lm.removeUpdates(listener) } } }
        }
    }

    private fun isMock(l: Location): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) l.isMock else @Suppress("DEPRECATION") l.isFromMockProvider

    companion object { private const val TAG = "LocationMonitor" }
}
