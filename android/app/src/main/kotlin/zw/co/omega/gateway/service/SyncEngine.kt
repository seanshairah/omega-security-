package zw.co.omega.gateway.service

import android.content.Context
import android.util.Log
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.util.DeviceInfo
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.location.LocationMonitor

/** Drains the outbox and sends heartbeats. Shared by the foreground service and the WorkManager fallback. */
class SyncEngine(private val context: Context) {
    private val prefs = Prefs(context)
    private val queue = EventQueue(context)

    sealed class Outcome { object Done : Outcome(); data class Retry(val error: String) : Outcome(); data class Rejected(val error: String) : Outcome() }

    /** Send queued events in order; stops at the first transport failure. */
    fun syncOnce(): Outcome {
        if (!prefs.isActivated) return Outcome.Rejected("not activated")
        if (!DeviceInfo.isOnline(context)) return Outcome.Retry("offline")
        val api = ApiClient(prefs.serverUrl, prefs.deviceToken)
        while (true) {
            val batch = queue.peek(100)
            if (batch.isEmpty()) return Outcome.Done
            try {
                val acks = api.sendEvents(batch.map { it.event })
                val ok = acks.filter { it.status == "ok" || it.status == "duplicate" }.map { it.eventId }
                queue.ack(ok)
                acks.filter { it.status == "rejected" }.forEach { Log.w(TAG, "event ${it.eventId} rejected: ${it.error}"); queue.drop(it.eventId) }
                // Anything the server did not mention stays queued for the next round.
                val mentioned = acks.map { it.eventId }.toSet()
                val unmentioned = batch.filter { it.event.eventId !in mentioned }
                if (unmentioned.isNotEmpty()) { queue.markAttempt(unmentioned.map { it.id }, "no ack"); if (unmentioned.size == batch.size) return Outcome.Retry("no acks") }
                prefs.lastSyncAt = System.currentTimeMillis()
                prefs.lastError = null
                prefs.authRejected = false
            } catch (e: ApiClient.ApiException) {
                queue.markAttempt(batch.map { it.id }, e.message)
                prefs.lastError = e.message
                if (e.status == 401 || e.status == 403) { prefs.authRejected = true; return Outcome.Rejected(e.message ?: "unauthorised") }
                return Outcome.Retry(e.message ?: "HTTP ${e.status}")
            } catch (e: Exception) {
                queue.markAttempt(batch.map { it.id }, e.message)
                prefs.lastError = e.message
                return Outcome.Retry(e.message ?: "network error")
            }
        }
    }

    fun heartbeat(): Outcome {
        if (!prefs.isActivated) return Outcome.Rejected("not activated")
        if (!DeviceInfo.isOnline(context)) { prefs.lastHeartbeatOk = false; return Outcome.Retry("offline") }
        return try {
            val api = ApiClient(prefs.serverUrl, prefs.deviceToken)
            val info = DeviceInfo.json(context).put("monitoringState", prefs.monitoringState).put("mockLocation", prefs.mockSeen)
                .put("shiftState", prefs.shiftState).put("gpsState", prefs.gpsState).put("gpsReason", prefs.gpsReason ?: JSONObject.NULL)
                .put("queuedEvents", queue.size()).put("configVersion", ShiftConfig.load(context)?.configVersion ?: JSONObject.NULL).put("lastEventSyncAt", if (prefs.lastSyncAt > 0) zw.co.omega.gateway.model.GatewayEvent.iso(prefs.lastSyncAt) else JSONObject.NULL)
            if (prefs.isGuardMode) LocationMonitor(context).lastFixJson()?.let { info.put("lastLocation", it) }
            val r = api.heartbeat(info)
            prefs.mode = r.mode
            r.guardName?.let { prefs.guardName = it }
            if (prefs.isGuardMode) refreshConfig(api)
            prefs.deviceName = r.deviceName.ifBlank { prefs.deviceName }
            prefs.phoneNumber = r.phoneNumber.ifBlank { prefs.phoneNumber }
            prefs.locationName = r.locationName ?: ""
            prefs.heartbeatSeconds = r.heartbeatSeconds
            prefs.lastHeartbeatAt = System.currentTimeMillis() // a heartbeat is not an event sync; lastSyncAt is set by syncOnce()
            prefs.lastHeartbeatOk = true
            prefs.lastError = null
            prefs.authRejected = false
            Outcome.Done
        } catch (e: ApiClient.ApiException) {
            prefs.lastHeartbeatOk = false; prefs.lastError = e.message
            if (e.status == 401 || e.status == 403) { prefs.authRejected = true; Outcome.Rejected(e.message ?: "unauthorised") } else Outcome.Retry(e.message ?: "HTTP ${e.status}")
        } catch (e: Exception) {
            prefs.lastHeartbeatOk = false; prefs.lastError = e.message
            Outcome.Retry(e.message ?: "network error")
        }
    }

    /** Pull the shift/site/policy for offline monitoring. Failures keep the cached copy. */
    fun refreshConfig(api: ApiClient = ApiClient(prefs.serverUrl, prefs.deviceToken)): ShiftConfig? {
        return try {
            val r = api.config()
            val cfg = ShiftConfig.fromServer(r)
            ShiftConfig.save(context, cfg)
            cfg
        } catch (e: Exception) {
            Log.w(TAG, "config refresh failed: ${e.message}")
            ShiftConfig.load(context)
        }
    }

    fun queueSize(): Int = queue.size()

    companion object { private const val TAG = "SyncEngine" }
}
