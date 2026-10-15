package zw.co.omega.gateway.call

import zw.co.omega.gateway.model.GatewayEvent
import java.util.UUID

/**
 * Turns Android phone-state transitions into gateway events. Pure Kotlin so it is unit-tested
 * without a device.
 *
 *   IDLE --RINGING--> RINGING --OFFHOOK--> IN_CALL --IDLE--> ended (answered)
 *                       |--IDLE--> ended (missed)
 *   IDLE --OFFHOOK--> IN_CALL (outgoing) --IDLE--> ended
 *
 * Android often delivers RINGING twice (first without the number, then with it, on Android 9+),
 * so CALL_STARTED is only emitted once the number is known or the state moves on.
 * The final CALL_ENDED/CALL_MISSED is emitted by [complete], after the caller has had a chance to
 * read the system call log for the authoritative duration and outcome.
 */
class CallTracker(
    private val sink: (GatewayEvent) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    enum class Phase { IDLE, RINGING, IN_CALL }

    data class Finished(val callId: String, val number: String?, val direction: String, val startedAt: Long, val answeredAt: Long?, val endedAt: Long)
    data class LogInfo(val answered: Boolean, val durationSeconds: Int, val number: String?)

    @Volatile var phase: Phase = Phase.IDLE
        private set
    private var callId: String? = null
    private var number: String? = null
    private var direction = "INCOMING"
    private var startedAt = 0L
    private var answeredAt: Long? = null
    private var startEmitted = false
    private var pendingOutgoingNumber: String? = null

    /** From NEW_OUTGOING_CALL (older Android) so the next OFFHOOK knows the dialled number. */
    @Synchronized
    fun onOutgoingNumber(dialled: String?) {
        pendingOutgoingNumber = dialled?.takeIf { it.isNotBlank() }
    }

    /**
     * @param state one of "RINGING", "OFFHOOK", "IDLE" (TelephonyManager.EXTRA_STATE_*)
     * @return the finished call when the phone went back to IDLE, else null
     */
    @Synchronized
    fun onPhoneState(state: String, incomingNumber: String?): Finished? {
        val now = clock()
        when (state) {
            "RINGING" -> {
                if (phase == Phase.IDLE) {
                    phase = Phase.RINGING
                    callId = newId(); direction = "INCOMING"; startedAt = now; answeredAt = null; startEmitted = false
                    number = incomingNumber?.takeIf { it.isNotBlank() }
                    if (number != null) emitStart()
                } else if (phase == Phase.RINGING && number == null && !incomingNumber.isNullOrBlank()) {
                    number = incomingNumber
                    emitStart()
                }
                return null
            }
            "OFFHOOK" -> {
                when (phase) {
                    Phase.RINGING -> {
                        if (!startEmitted) emitStart()
                        answeredAt = now
                        phase = Phase.IN_CALL
                        sink(GatewayEvent(eventId = newId(), eventType = GatewayEvent.CALL_ANSWERED, callId = callId, timestampMs = now))
                    }
                    Phase.IDLE -> {
                        phase = Phase.IN_CALL
                        callId = newId(); direction = "OUTGOING"; startedAt = now; answeredAt = null
                        number = pendingOutgoingNumber; pendingOutgoingNumber = null
                        emitStart()
                    }
                    Phase.IN_CALL -> {}
                }
                return null
            }
            "IDLE" -> {
                if (phase == Phase.IDLE) return null
                if (!startEmitted) emitStart()
                val f = Finished(callId!!, number, direction, startedAt, answeredAt, now)
                phase = Phase.IDLE; callId = null; number = null; answeredAt = null; startEmitted = false
                return f
            }
            else -> return null
        }
    }

    /** Emit the terminal event, preferring the system call log's verdict when available. */
    @Synchronized
    fun complete(f: Finished, log: LogInfo?) {
        val answered = log?.answered ?: (f.answeredAt != null)
        val duration = log?.durationSeconds ?: f.answeredAt?.let { ((f.endedAt - it) / 1000).toInt().coerceAtLeast(0) } ?: 0
        if (f.direction == "INCOMING" && !answered) {
            sink(GatewayEvent(eventId = newId(), eventType = GatewayEvent.CALL_MISSED, callId = f.callId, phoneNumber = f.number ?: log?.number, direction = f.direction, timestampMs = f.endedAt, durationSeconds = 0, answered = false))
        } else {
            sink(GatewayEvent(eventId = newId(), eventType = GatewayEvent.CALL_ENDED, callId = f.callId, phoneNumber = f.number ?: log?.number, direction = f.direction, timestampMs = f.endedAt, durationSeconds = duration, answered = answered))
        }
    }

    private fun emitStart() {
        startEmitted = true
        sink(GatewayEvent(eventId = newId(), eventType = GatewayEvent.CALL_STARTED, callId = callId, phoneNumber = number, direction = direction, timestampMs = startedAt))
    }
}
