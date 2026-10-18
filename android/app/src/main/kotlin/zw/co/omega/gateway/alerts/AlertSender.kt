package zw.co.omega.gateway.alerts

import android.content.Context
import android.util.Log
import org.json.JSONObject
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.Priority
import zw.co.omega.gateway.service.Trigger
import zw.co.omega.gateway.util.DeviceInfo
import java.util.UUID

/**
 * Guard-initiated alerts and status messages. Every one is written to the durable outbox first
 * (so nothing is lost if the phone is offline or dies), then the sync engine is asked to send it
 * at once. An emergency never waits for a fresh GPS fix: it goes with the last fix the phone has
 * (and how old it is), and a location check is requested in parallel so a fresh position follows.
 */
object AlertSender {
    private const val TAG = "AlertSender"

    enum class Type(val wire: String, val priority: Int, val needsAck: Boolean) {
        EMERGENCY("EMERGENCY", Priority.EMERGENCY, true),
        NEED_ASSISTANCE("NEED_ASSISTANCE", Priority.HIGH, true),
        INCIDENT_REPORT("INCIDENT_REPORT", Priority.HIGH, true),
        SECURITY_ALERT("SECURITY_ALERT", Priority.HIGH, true),
        RUNNING_LATE("RUNNING_LATE", Priority.HIGH, true),
        STATUS_UPDATE("STATUS_UPDATE", Priority.NORMAL, false),
        SHIFT_OK("SHIFT_OK", Priority.NORMAL, false),
        HANDOVER("HANDOVER", Priority.NORMAL, false),
    }

    /** What the caller shows the guard: saved, and whether there is a connection to deliver it on. */
    data class Outcome(val eventId: String, val online: Boolean, val hadLocation: Boolean, val opsPhone: String)

    /** Fixes older than this are still sent (with their age) but flagged so operations does not over-read them. */
    private const val FRESH_MS = 5 * 60_000L

    fun send(context: Context, type: Type, message: String?): Outcome {
        val app = context.applicationContext
        val prefs = Prefs(app)
        val now = System.currentTimeMillis()
        val cfg = ShiftConfig.load(app)
        val extra = JSONObject()
        message?.trim()?.takeIf { it.isNotEmpty() }?.let { extra.put("message", it.take(500)) }
        cfg?.shiftId?.let { extra.put("shiftId", it) }
        var hadLocation = false
        if (prefs.lastFixAt > 0L) {
            val age = ((now - prefs.lastFixAt) / 1000).toInt().coerceAtLeast(0)
            extra.put("location", JSONObject().put("latitude", prefs.lastFixLat).put("longitude", prefs.lastFixLng).put("accuracyM", prefs.lastFixAccuracy.toDouble()).put("state", prefs.lastFixState).put("ageSeconds", age))
            hadLocation = true
            if (now - prefs.lastFixAt > FRESH_MS) Log.i(TAG, "attaching a ${age}s old fix; a fresh check is requested")
        }
        extra.put("meta", JSONObject().put("online", DeviceInfo.isOnline(app)).put("battery", DeviceInfo.batteryLevel(app)))
        val event = GatewayEvent(eventId = UUID.randomUUID().toString(), eventType = type.wire, timestampMs = now, extra = extra)
        val queue = EventQueue(app)
        queue.enqueue(event, type.priority)
        queue.logComm(event.eventId, "ALERT", type.wire, message?.trim()?.takeIf { it.isNotEmpty() }, now, hadLocation)
        val online = DeviceInfo.isOnline(app)
        GatewayService.requestSync(app, if (type == Type.EMERGENCY) Trigger.EMERGENCY else Trigger.NEW_EVENT)
        if (prefs.isGuardMode && type.needsAck) GatewayService.requestLocationCheck(app) // a fresh position follows; the alert itself did not wait for it
        Log.i(TAG, "queued ${type.wire} online=$online location=$hadLocation")
        return Outcome(event.eventId, online, hadLocation, prefs.opsPhone)
    }
}
