package zw.co.omega.gateway.service

import android.content.Context
import android.util.Log
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.location.LocationMonitor
import zw.co.omega.gateway.model.DeviceCommand
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.util.DeviceInfo

/**
 * One sync run (drain the outbox) and one heartbeat. Shared by the foreground service's
 * SyncCoordinator and the WorkManager fallback; a process-wide lock keeps the two from sending
 * the same rows at the same time. Pure of GPS: it never reads or changes monitoring state.
 */
class SyncEngine(private val context: Context) {
    private val prefs = Prefs(context)
    private val queue = EventQueue(context)

    sealed class Outcome { object Done : Outcome(); data class Retry(val error: String) : Outcome(); data class Rejected(val error: String) : Outcome() }

    data class RunReport(val outcome: Outcome, val sent: Int, val acked: Int, val duplicates: Int, val rejected: Int, val retried: Int)

    /** Send due events, highest priority first, in batches of 100; stops at the first transport failure. Every run is logged. */
    fun syncOnce(trigger: Trigger = Trigger.MANUAL): Outcome = synchronized(LOCK) { run(trigger).outcome }

    fun syncOnceReport(trigger: Trigger = Trigger.MANUAL): RunReport = synchronized(LOCK) { run(trigger) }

    private fun run(trigger: Trigger): RunReport {
        val started = System.currentTimeMillis()
        val online = DeviceInfo.isOnline(context)
        var sent = 0; var acked = 0; var dups = 0; var rejected = 0; var retried = 0
        prefs.lastSyncAttemptAt = started
        prefs.lastSyncTrigger = trigger.name
        fun finish(outcome: Outcome, error: String? = null): RunReport {
            queue.log(EventQueue.LogRow(started, trigger.name, online, sent, acked, dups, rejected, retried, error, System.currentTimeMillis() - started))
            prefs.lastSyncError = error
            refreshSyncState()
            return RunReport(outcome, sent, acked, dups, rejected, retried)
        }
        if (!prefs.isActivated) return finish(Outcome.Rejected("not activated"), "not activated")
        if (!online) return finish(Outcome.Retry("offline"), "offline")
        val api = ApiClient(prefs.serverUrl, prefs.deviceToken)
        queue.purgeFailed()
        while (true) {
            val batch = queue.due(limit = 100)
            if (batch.isEmpty()) return finish(Outcome.Done)
            queue.markSending(batch.map { it.id })
            sent += batch.size
            try {
                val acks = api.sendEvents(batch.map { it.event })
                val byId = acks.associateBy { it.eventId }
                val ok = mutableListOf<String>(); val retry = mutableListOf<EventQueue.Row>()
                for (row in batch) {
                    val a = byId[row.event.eventId]
                    when (SyncPlanner.ackOutcome(a?.status)) {
                        AckOutcome.ACKED -> { ok += row.event.eventId; if (a?.status == "duplicate") dups++ else acked++ }
                        AckOutcome.FAILED_PERMANENT -> { rejected++; Log.w(TAG, "event ${row.event.eventId} rejected: ${a?.error}"); queue.fail(row.event.eventId, a?.error); queue.markCommFailed(row.event.eventId, a?.error) }
                        AckOutcome.UNKNOWN -> retry += row
                    }
                }
                queue.ack(ok)
                queue.markCommSent(ok)
                if (retry.isNotEmpty()) { retried += retry.size; queue.markRetry(retry, "no ack"); if (retry.size == batch.size) return finish(Outcome.Retry("no acks"), "no acks") }
                if (ok.isNotEmpty()) { prefs.lastSyncAt = System.currentTimeMillis(); prefs.lastError = null; prefs.authRejected = false }
            } catch (e: ApiClient.ApiException) {
                retried += batch.size
                queue.markRetry(batch, e.message)
                prefs.lastError = e.message
                if (e.status == 401 || e.status == 403) { prefs.authRejected = true; return finish(Outcome.Rejected(e.message ?: "unauthorised"), e.message) }
                return finish(Outcome.Retry(e.message ?: "HTTP ${e.status}"), e.message)
            } catch (e: Exception) {
                retried += batch.size
                queue.markRetry(batch, e.message)
                prefs.lastError = e.message
                return finish(Outcome.Retry(e.message ?: "network error"), e.message ?: "network error")
            }
        }
    }

    /** Recompute the dashboard's sync state from the outbox; also called after the service's `syncing` flag changes. */
    fun refreshSyncState(syncing: Boolean = false) {
        val c = queue.counts()
        prefs.syncState = SyncPlanner.syncState(DeviceInfo.isOnline(context), prefs.authRejected, c.queued + c.sending, c.retryPending, c.failed, syncing)
    }

    /** Receives operations commands (REQUEST_LOCATION) from heartbeats and polls. Set by the service. */
    @Volatile var commandSink: ((List<DeviceCommand>) -> Unit)? = null

    /**
     * Lightweight command poll between heartbeats (guard mode only). Returns false when offline or
     * rejected so the caller can back off. Never touches the outbox: event sync is independent.
     */
    fun pollCommands(): Boolean {
        // Both modes: a guard phone receives location requests, an operations phone call requests.
        if (!prefs.isActivated || !DeviceInfo.isOnline(context) || prefs.authRejected) return false
        return try {
            val r = ApiClient(prefs.serverUrl, prefs.deviceToken).commands()
            prefs.commandPollSeconds = r.optInt("commandPollSeconds", prefs.commandPollSeconds)
            val cmds = DeviceCommand.listFromJson(r.optJSONArray("commands"))
            if (cmds.isNotEmpty()) commandSink?.invoke(cmds)
            true
        } catch (e: ApiClient.ApiException) {
            if (e.status == 401 || e.status == 403) prefs.authRejected = true
            false
        } catch (e: Exception) { false }
    }

    fun heartbeat(): Outcome {
        if (!prefs.isActivated) return Outcome.Rejected("not activated")
        if (!DeviceInfo.isOnline(context)) { prefs.lastHeartbeatOk = false; return Outcome.Retry("offline") }
        return try {
            val api = ApiClient(prefs.serverUrl, prefs.deviceToken)
            val c = queue.counts()
            val info = DeviceInfo.json(context).put("monitoringState", prefs.monitoringState).put("mockLocation", prefs.mockSeen)
                .put("shiftState", prefs.shiftState).put("gpsState", prefs.gpsState).put("gpsReason", prefs.gpsReason ?: JSONObject.NULL)
                .put("syncState", prefs.syncState).put("queuedEvents", c.pending).put("failedEvents", c.failed)
                .put("lastEventSyncAt", if (prefs.lastSyncAt > 0) GatewayEvent.iso(prefs.lastSyncAt) else JSONObject.NULL)
                .put("lastSyncAttemptAt", if (prefs.lastSyncAttemptAt > 0) GatewayEvent.iso(prefs.lastSyncAttemptAt) else JSONObject.NULL)
                .put("lastSyncError", prefs.lastSyncError ?: JSONObject.NULL).put("lastSyncTrigger", prefs.lastSyncTrigger ?: JSONObject.NULL)
                .put("oldestPendingSeconds", queue.oldestPendingMs()?.let { it / 1000 } ?: JSONObject.NULL)
                .put("configVersion", ShiftConfig.load(context)?.configVersion ?: JSONObject.NULL)
                .put("secureStorage", prefs.secureStorage).put("buildType", if (zw.co.omega.gateway.BuildConfig.DEBUG) "debug" else "release")
            if (prefs.isGuardMode) LocationMonitor(context).lastFixJson()?.let { info.put("lastLocation", it) }
            val r = api.heartbeat(info)
            prefs.mode = r.mode
            r.guardName?.let { prefs.guardName = it }
            r.opsPhone?.let { prefs.opsPhone = it }
            prefs.commandPollSeconds = r.commandPollSeconds
            r.commands?.let { arr -> commandSink?.invoke(DeviceCommand.listFromJson(arr)) }
            r.alerts?.let { arr ->
                // Operations' acknowledgements for the alerts this guard sent.
                val iso = { v: String? -> v?.takeIf { it.isNotBlank() }?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } }
                for (i in 0 until arr.length()) {
                    val a = arr.optJSONObject(i) ?: continue
                    queue.applyServerAlertState(a.optString("eventId"), a.optString("status"), a.optString("acknowledgedBy").ifBlank { null }, iso(a.optString("acknowledgedAt")), a.optString("acknowledgementNote").ifBlank { null }, iso(a.optString("resolvedAt")))
                }
            }
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

    /** Pull the shift/site/policy for offline monitoring. Failures keep the cached copy. Returns true when the config changed. */
    fun refreshConfig(api: ApiClient = ApiClient(prefs.serverUrl, prefs.deviceToken)): Boolean {
        return try {
            val before = ShiftConfig.fingerprint(ShiftConfig.load(context))
            val cfg = ShiftConfig.fromServer(api.config())
            ShiftConfig.save(context, cfg) // notifies ConfigBus when anything that matters changed
            ShiftConfig.fingerprint(cfg) != before
        } catch (e: Exception) {
            Log.w(TAG, "config refresh failed: ${e.message}")
            false
        }
    }

    fun queueSize(): Int = queue.size()
    fun nextRetryAt(): Long? = queue.nextAttemptAt()

    companion object { private const val TAG = "SyncEngine"; private val LOCK = Any() }
}
