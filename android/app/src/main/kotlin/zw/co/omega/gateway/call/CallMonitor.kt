package zw.co.omega.gateway.call

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.Trigger
import zw.co.omega.gateway.service.CommandWakeSource
import zw.co.omega.gateway.location.LocationMonitor
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Process-wide bridge from phone-state broadcasts to the outbox. Both the manifest receiver and
 * the service's dynamic receiver land here, so a broadcast delivered twice is coalesced by the
 * tracker's state machine.
 */
object CallMonitor {
    private const val TAG = "CallMonitor"
    private val handler = Handler(Looper.getMainLooper())
    private var tracker: CallTracker? = null

    private fun tracker(context: Context): CallTracker {
        val app = context.applicationContext
        return tracker ?: CallTracker(sink = { event -> enqueue(app, event) }).also { tracker = it }
    }

    private fun enqueue(app: Context, raw: GatewayEvent) {
        val prefs = Prefs(app)
        // Guard phone: attach where the guard was at the time of the call. Never a fresh stream, just the last fix.
        val event = if (prefs.isGuardMode) LocationMonitor(app).lastFixJson()?.let { raw.copy(extra = JSONObject().put("location", it)) } ?: raw else raw
        val q = EventQueue.get(app)
        q.enqueue(event)
        if (event.eventType == GatewayEvent.CALL_STARTED || event.eventType == GatewayEvent.CALL_ENDED || event.eventType == GatewayEvent.CALL_MISSED) {
            val what = when (event.eventType) { GatewayEvent.CALL_STARTED -> if (event.direction == "OUTGOING") "Outgoing call" else "Incoming call"; GatewayEvent.CALL_MISSED -> "Missed call"; else -> "Call ended · ${event.durationSeconds ?: 0}s" }
            q.logComm(event.eventId, "CALL", event.eventType, "$what · ${event.phoneNumber ?: "unknown number"}", event.timestampMs, event.extra?.has("location") == true)
        }
        GatewayService.requestSync(app, Trigger.NEW_EVENT)
        if (prefs.isGuardMode && event.eventType == GatewayEvent.CALL_STARTED) GatewayService.requestLocationCheck(app) // refresh the fix around the call
        // A check-in call makes the server create a location request for this phone, but it can only
        // do that once the call event has been uploaded. The command poll that follows a sync may
        // therefore run a moment too early, leaving the request waiting for the next poll up to
        // half a minute later. A second poll a few seconds afterwards closes that gap, so a guard
        // who rings in is asked for a fix straight away rather than after the next cycle.
        if (prefs.isGuardMode && (event.eventType == GatewayEvent.CALL_STARTED || event.eventType == GatewayEvent.CALL_ENDED)) {
            handler.postDelayed({ CommandWakeSource.onWake() }, 6_000)
        }
        if (event.eventType == GatewayEvent.CALL_STARTED || event.eventType == GatewayEvent.CALL_ENDED || event.eventType == GatewayEvent.CALL_MISSED) {
            val label = when (event.eventType) { GatewayEvent.CALL_STARTED -> if (event.direction == "OUTGOING") "Dialling" else "Ringing"; GatewayEvent.CALL_MISSED -> "Missed"; else -> "Ended ${event.durationSeconds ?: 0}s" }
            prefs.lastCallSummary = "${event.phoneNumber ?: "unknown number"} · $label"
            prefs.lastCallAt = event.timestampMs
        }
        Log.i(TAG, "queued ${event.eventType} call=${event.callId}")
    }

    fun onOutgoing(context: Context, number: String?) = tracker(context).onOutgoingNumber(number)

    fun onPhoneState(context: Context, state: String?, incomingNumber: String?) {
        if (state.isNullOrBlank()) return
        val app = context.applicationContext
        val finished = tracker(app).onPhoneState(state, incomingNumber) ?: return
        // The system writes the call log a moment after IDLE; read it for the authoritative verdict.
        handler.postDelayed({ tracker(app).complete(finished, readCallLog(app, finished)) }, 2500)
    }

    private fun readCallLog(context: Context, f: CallTracker.Finished): CallTracker.LogInfo? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return null
        return try {
            context.contentResolver.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.DATE), "${CallLog.Calls.DATE} >= ?", arrayOf((f.startedAt - 60_000).toString()), "${CallLog.Calls.DATE} DESC")?.use { c ->
                if (!c.moveToFirst()) return null
                val number = c.getString(0)
                val type = c.getInt(1)
                val duration = c.getInt(2)
                val answered = when (type) {
                    CallLog.Calls.MISSED_TYPE, CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> false
                    CallLog.Calls.INCOMING_TYPE -> duration > 0
                    CallLog.Calls.OUTGOING_TYPE -> duration > 0
                    else -> duration > 0
                }
                CallTracker.LogInfo(answered, duration, number)
            }
        } catch (e: Exception) {
            Log.w(TAG, "call log read failed: ${e.message}")
            null
        }
    }

    fun fmt(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

    /** True when the app can see call states and numbers. */
    fun canMonitor(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    fun canSeeNumbers(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    @Suppress("DEPRECATION")
    fun extraState(intent: android.content.Intent): String? = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
    @Suppress("DEPRECATION")
    fun extraNumber(intent: android.content.Intent): String? = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
}
