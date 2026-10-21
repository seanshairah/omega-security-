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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.geofence.*
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.Trigger
import zw.co.omega.gateway.util.DeviceInfo
import java.util.UUID

/**
 * Shift-aware location monitoring for guard devices. One `step()` per check, run by the
 * MonitoringCoordinator inside the foreground service.
 *
 * - Platform LocationManager only (no Play Services): GPS and network providers are listened to
 *   at the same time for up to the acquisition budget; the best fix wins (see AcquisitionPolicy).
 * - Classifies the fix locally against the cached site and radius, drives the pure state
 *   machine, and queues events to the same outbox as calls. Needs no internet at all.
 * - Writes three separate facts for the dashboard and the server: shift state, GPS state with
 *   its reason, and the composite `monitoringState` kept for older portal versions.
 * - The accuracy safeguard is unchanged: a fix worse than `policy.accuracyMaxM` is UNKNOWN
 *   (`poor_accuracy`), never INSIDE or OUTSIDE.
 */
class LocationMonitor(private val context: Context) {
    private val prefs = Prefs(context)
    private val queue = EventQueue.get(context)
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    @Volatile var state = MonitorState()
        private set
    private var configShiftId: String? = null
    /** One acquisition at a time, shared by shift monitoring and operations requests: never two listeners competing. */
    private val acquisitionLock = Mutex()

    data class Result(val phase: Phase, val nextCheckSeconds: Int, val fix: Location?, val classification: Classification?, val producedEvents: Boolean, val hasConfig: Boolean)

    /** One monitoring step. Returns how long to wait before the next one (≤ 0 when no config is cached yet). */
    suspend fun step(now: Long = System.currentTimeMillis()): Result {
        val cfg = ShiftConfig.load(context)
        prefs.lastAttemptAt = now
        if (cfg == null || !cfg.isActiveAt(now)) {
            val upcoming = cfg != null && cfg.isUpcomingAt(now)
            val phase = if (upcoming) Phase.WAITING_FOR_SHIFT else Phase.NOT_ON_SHIFT
            if (state.phase != phase) { state = MonitorState(phase, now); configShiftId = null }
            prefs.monitoringState = phase.name
            prefs.shiftState = if (upcoming) "UPCOMING" else "NONE"
            prefs.gpsState = "OFF"
            prefs.gpsReason = null
            prefs.dutySiteName = cfg?.site?.name ?: ""
            val wait = when { cfg == null -> 0; upcoming -> ((cfg.startAtMs - 10 * 60_000L - now) / 1000).toInt().coerceIn(60, 15 * 60); else -> 15 * 60 }
            return Result(phase, wait, null, null, producedEvents = false, hasConfig = cfg != null)
        }
        prefs.shiftState = "ACTIVE"
        prefs.dutySiteName = cfg.site?.name ?: ""
        val fix = obtainFix(cfg.policy)
        val obs = observe(fix, cfg, now)
        val c = fix?.let { f -> cfg.site?.let { classify(f.latitude, f.longitude, f.accuracy, it, cfg.policy.accuracyMaxM) } }
        var produced = false
        if (configShiftId != cfg.shiftId) {
            // New shift: announce monitoring with the first fix, then seed the state machine from it.
            configShiftId = cfg.shiftId
            state = MonitorState(Phase.MONITORING, now)
            enqueue("SHIFT_STARTED", obs, fix, cfg); produced = true
        }
        val r = stepMonitor(state, obs, cfg.policy)
        state = r.next
        for (e in r.events) { enqueue(e.type, obs.copy(reason = e.reason ?: obs.reason), fix, cfg, e.durationOutsideSeconds); produced = true }
        // Record the observation even when the state machine emitted nothing (e.g. a repeated UNKNOWN).
        prefs.lastCheckAt = obs.at
        prefs.gpsState = state.phase.name
        prefs.gpsReason = if (obs.state == LocState.UNKNOWN) obs.reason else null
        if (fix != null) { prefs.lastFixLat = fix.latitude; prefs.lastFixLng = fix.longitude; prefs.lastFixAccuracy = fix.accuracy; prefs.lastFixAt = obs.at; prefs.lastFixState = obs.state.name; prefs.lastFixDistanceM = (obs.distanceM ?: -1.0).toFloat() }
        prefs.monitoringState = if (!DeviceInfo.isOnline(context) && state.phase == Phase.MONITORING) "OFFLINE_MONITORING" else state.phase.name
        val battery = DeviceInfo.batteryLevel(context)
        val wait = alignToShiftStart(adjustForBattery(r.nextCheckSeconds, battery, state.phase), now, cfg.startAtMs)
        prefs.batterySaver = wait > r.nextCheckSeconds
        return Result(state.phase, wait, fix, c, produced, hasConfig = true)
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
            put("meta", JSONObject().put("phase", state.phase.name).put("online", DeviceInfo.isOnline(context)).put("accuracyMaxM", cfg.policy.accuracyMaxM))
        }
        queue.enqueue(GatewayEvent(eventId = UUID.randomUUID().toString(), eventType = type, timestampMs = o.at, extra = extra))
        // The coordinator also asks for a sync after the step; this covers callers outside the service.
        GatewayService.requestSync(context, Trigger.NEW_EVENT)
        Log.i(TAG, "queued $type ${o.state} ${o.distanceM?.let { "${it.toInt()} m" } ?: ""} ${fix?.let { "±${it.accuracy} m ${it.provider}" } ?: ""} ${o.reason ?: ""}")
    }

    /** The latest fix as the server expects it, for heartbeats and call events. */
    fun lastFixJson(): JSONObject? {
        if (prefs.lastFixAt <= 0L) return null
        return JSONObject().put("latitude", prefs.lastFixLat).put("longitude", prefs.lastFixLng).put("accuracyM", prefs.lastFixAccuracy.toDouble()).put("at", GatewayEvent.iso(prefs.lastFixAt)).put("locationState", prefs.lastFixState).put("state", prefs.lastFixState)
    }

    fun hasLocationPermission(): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * One fresh fix. Listens to GPS and network together for up to the budget, keeps the best
     * reading and stops early when it is good enough (see AcquisitionPolicy). Falls back to a
     * last-known fix under two minutes old. Marks `gpsChecking` while running.
     */
    suspend fun obtainFix(policy: Policy, acquisition: AcquisitionPolicy = AcquisitionPolicy(acceptableM = policy.accuracyMaxM.toFloat())): Location? = acquisitionLock.withLock { acquire(acquisition) }

    /**
     * A fresh fix for an operations request. Waits for any running shift check to finish (the
     * lock), then listens with the request's own budget. Never serves a cached last-known fix: a
     * request answered with old data would be a lie, so a miss is a miss.
     */
    suspend fun acquireForRequest(acquisition: AcquisitionPolicy): Location? = acquisitionLock.withLock {
        if (!hasLocationPermission()) return@withLock null
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) return@withLock null
        prefs.gpsChecking = true
        try { listen(providers, acquisition) } finally { prefs.gpsChecking = false }
    }

    fun isMockFix(l: Location): Boolean = isMock(l)

    private suspend fun acquire(acquisition: AcquisitionPolicy): Location? {
        if (!hasLocationPermission()) return null
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) return null
        prefs.gpsChecking = true
        try {
            val fresh = listen(providers, acquisition)
            if (fresh != null) return fresh
            return try { listOfNotNull(lm.getLastKnownLocation(LocationManager.GPS_PROVIDER), lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)).filter { System.currentTimeMillis() - it.time < 120_000 }.minByOrNull { it.accuracy } } catch (e: SecurityException) { null }
        } finally { prefs.gpsChecking = false }
    }

    private suspend fun listen(providers: List<String>, acquisition: AcquisitionPolicy): Location? {
        val updates = Channel<Location>(Channel.UNLIMITED)
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { updates.trySend(location) }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        val main = Handler(Looper.getMainLooper())
        main.post { for (p in providers) try { lm.requestLocationUpdates(p, 1000L, 0f, listener, Looper.getMainLooper()) } catch (e: Exception) { Log.w(TAG, "requestLocationUpdates $p: ${e.message}") } }
        val started = System.currentTimeMillis()
        var best: Location? = null
        try {
            while (true) {
                val elapsed = System.currentTimeMillis() - started
                val summary = best?.let { FixSummary(it.accuracy, it.time, it.provider ?: "?") }
                if (decide(acquisition, summary, elapsed) == Decision.STOP) break
                val next = withTimeoutOrNull(acquisition.budgetMs - elapsed) { updates.receive() } ?: break
                val cand = FixSummary(next.accuracy, next.time, next.provider ?: "?")
                val cur = best?.let { FixSummary(it.accuracy, it.time, it.provider ?: "?") }
                if (better(cur, cand) === cand) best = next
            }
        } finally {
            main.post { runCatching { lm.removeUpdates(listener) } }
            updates.close()
        }
        return best
    }

    private fun isMock(l: Location): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) l.isMock else @Suppress("DEPRECATION") l.isFromMockProvider


    companion object {
        private const val TAG = "LocationMonitor"

        /**
         * Before the shift, the next check lands on the start time itself rather than wherever the
         * interval falls. The server judges attendance from the first fix inside the site, and the
         * one taken at the start is the one that settles "on time" for a guard who arrived late in
         * the ten-minute run-up.
         */
        fun alignToShiftStart(waitSeconds: Int, nowMs: Long, startAtMs: Long): Int {
            if (nowMs >= startAtMs) return waitSeconds
            val untilStart = ((startAtMs - nowMs) / 1000).toInt()
            return if (untilStart in 1 until waitSeconds) untilStart.coerceAtLeast(30) else waitSeconds
        }
    }
}
