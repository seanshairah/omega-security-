package zw.co.omega.gateway.service

import android.app.ActivityManager
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.location.FixSummary
import zw.co.omega.gateway.location.LocationMonitor
import zw.co.omega.gateway.location.LocationRequestPolicy
import zw.co.omega.gateway.location.LocationRequestPolicy.Outcome
import zw.co.omega.gateway.model.DeviceCommand
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.util.DeviceInfo
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Handles REQUEST_LOCATION commands from operations.
 *
 * One acquisition per command id (in-flight set + persisted "handled" ids), an expired command is
 * answered without touching the GPS, the fix is taken through the same LocationMonitor and the
 * same acquisition lock as shift monitoring (no second GPS pipeline), and the answer goes into the
 * ordinary outbox as a LOCATION_REQUEST_RESULT event so it survives offline and retries like every
 * other event. The guard sees the request in the Communication history.
 */
class LocationRequestHandler(private val context: Context, private val scope: CoroutineScope, private val monitor: LocationMonitor) {
    private val prefs = Prefs(context)
    private val queue = EventQueue(context)
    private val inFlight = ConcurrentHashMap.newKeySet<String>()

    fun handle(commands: List<DeviceCommand>) {
        for (c in commands) {
            if (c.type != DeviceCommand.REQUEST_LOCATION) { Log.w(TAG, "ignoring unknown command ${c.type}"); continue }
            if (prefs.isCommandHandled(c.id) || !inFlight.add(c.id)) continue
            scope.launch(Dispatchers.IO) { try { run(c) } catch (e: Exception) { Log.e(TAG, "request ${c.id} failed: ${e.message}"); answer(c, Outcome.Failed("INTERNAL_ERROR", e.javaClass.simpleName)) } finally { inFlight.remove(c.id) } }
        }
    }

    private suspend fun run(c: DeviceCommand) {
        if (!prefs.isGuardMode) { answer(c, Outcome.Failed("DEVICE_UNAVAILABLE", "not in guard mode")); return }
        val now = System.currentTimeMillis()
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = runCatching { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)
        when (LocationRequestPolicy.precheck(c, now, monitor.hasLocationPermission(), providers)) {
            LocationRequestPolicy.Precheck.EXPIRED -> { answer(c, Outcome.Failed("REQUEST_EXPIRED", "seen after the deadline")); return }
            LocationRequestPolicy.Precheck.PERMISSION_DENIED -> { answer(c, Outcome.Failed("PERMISSION_DENIED", null)); return }
            LocationRequestPolicy.Precheck.LOCATION_DISABLED -> { answer(c, Outcome.Failed("LOCATION_DISABLED", null)); return }
            LocationRequestPolicy.Precheck.OK -> {}
        }
        queue.logComm("req-${c.id}", "operations", "LOCATION_REQUEST", "Operations asked for your current position", now, false)
        // Best-effort acknowledgement; a failure here is not a failure of the request.
        withContext(Dispatchers.IO) { runCatching { ApiClient(prefs.serverUrl, prefs.deviceToken).ackCommand(c.id, "PROCESSING") }.onFailure { Log.i(TAG, "ack ${c.id}: ${it.message}") } }

        // A fix the shift monitor took moments ago may answer the request if it is fresh and precise enough.
        if (LocationRequestPolicy.canReuse(c, prefs.lastFixAt, prefs.lastFixAccuracy, now)) {
            answer(c, Outcome.Completed(prefs.lastFixLat, prefs.lastFixLng, prefs.lastFixAccuracy, "reused", prefs.lastFixAt, prefs.mockSeen, reused = true)); return
        }
        val restricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isBackgroundRestricted
        val fix = monitor.acquireForRequest(LocationRequestPolicy.acquisition(c, System.currentTimeMillis()))
        val summary = fix?.let { FixSummary(it.accuracy, it.time, it.provider ?: "unknown") }
        val mock = fix != null && monitor.isMockFix(fix)
        answer(c, LocationRequestPolicy.judge(c, summary, fix?.latitude, fix?.longitude, fix?.provider, mock, reused = false, backgroundRestricted = restricted))
    }

    private fun answer(c: DeviceCommand, o: Outcome) {
        val now = System.currentTimeMillis()
        val extra = JSONObject().put("requestId", c.id).put("meta", JSONObject().put("online", DeviceInfo.isOnline(context)).put("battery", DeviceInfo.batteryLevel(context)).put("appVersion", DeviceInfo.json(context).optString("appVersion")))
        when (o) {
            is Outcome.Completed -> {
                extra.put("status", "COMPLETED").put("latitude", o.latitude).put("longitude", o.longitude).put("accuracyM", o.accuracyM.toDouble()).put("provider", o.provider).put("capturedAt", GatewayEvent.iso(o.capturedAtMs)).put("mock", o.mock)
                extra.getJSONObject("meta").put("reused", o.reused)
                if (o.mock) prefs.mockSeen = true
                if (!o.reused) { prefs.lastFixLat = o.latitude; prefs.lastFixLng = o.longitude; prefs.lastFixAccuracy = o.accuracyM; prefs.lastFixAt = o.capturedAtMs }
            }
            is Outcome.Failed -> {
                extra.put("status", "FAILED").put("failureReason", o.reason)
                o.detail?.let { extra.put("failureDetail", it) }
                o.latitude?.let { extra.put("latitude", it) }; o.longitude?.let { extra.put("longitude", it) }; o.accuracyM?.let { extra.put("accuracyM", it.toDouble()) }; o.capturedAtMs?.let { extra.put("capturedAt", GatewayEvent.iso(it)) }
            }
        }
        val ev = GatewayEvent(eventId = UUID.randomUUID().toString(), eventType = EVENT_TYPE, timestampMs = now, extra = extra)
        queue.enqueue(ev, Priority.HIGH)
        prefs.markCommandHandled(c.id)
        val summary = when (o) { is Outcome.Completed -> "Position sent to operations (±${o.accuracyM.toInt()} m)"; is Outcome.Failed -> "Position could not be sent: ${o.reason.lowercase().replace('_', ' ')}" }
        queue.logComm(ev.eventId, "operations", "LOCATION_REQUEST_RESULT", summary, now, o is Outcome.Completed)
        GatewayService.requestSync(context, Trigger.NEW_EVENT)
        Log.i(TAG, "request ${c.id}: $summary")
    }

    companion object { const val TAG = "LocationRequest"; const val EVENT_TYPE = "LOCATION_REQUEST_RESULT" }
}
