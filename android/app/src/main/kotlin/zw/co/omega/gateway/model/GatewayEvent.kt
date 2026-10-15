package zw.co.omega.gateway.model

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** One event for POST /api/gateways/events. `eventId` is unique per event so retries are harmless. */
data class GatewayEvent(
    val eventId: String,
    val eventType: String,
    val callId: String? = null,
    val phoneNumber: String? = null,
    val direction: String? = null,
    val timestampMs: Long,
    val durationSeconds: Int? = null,
    val answered: Boolean? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("eventId", eventId)
        put("eventType", eventType)
        callId?.let { put("callId", it) }
        phoneNumber?.let { put("phoneNumber", it) }
        direction?.let { put("direction", it) }
        put("timestamp", iso(timestampMs))
        durationSeconds?.let { put("durationSeconds", it) }
        answered?.let { put("answered", it) }
    }

    companion object {
        const val CALL_STARTED = "CALL_STARTED"
        const val CALL_ANSWERED = "CALL_ANSWERED"
        const val CALL_ENDED = "CALL_ENDED"
        const val CALL_MISSED = "CALL_MISSED"
        const val DEVICE_ONLINE = "DEVICE_ONLINE"
        const val DEVICE_OFFLINE = "DEVICE_OFFLINE"

        fun iso(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))

        fun fromJson(o: JSONObject): GatewayEvent = GatewayEvent(
            eventId = o.getString("eventId"), eventType = o.getString("eventType"),
            callId = o.optString("callId").ifBlank { null }, phoneNumber = o.optString("phoneNumber").ifBlank { null },
            direction = o.optString("direction").ifBlank { null },
            timestampMs = o.optLong("timestampMs", System.currentTimeMillis()),
            durationSeconds = if (o.has("durationSeconds")) o.getInt("durationSeconds") else null,
            answered = if (o.has("answered")) o.getBoolean("answered") else null,
        )

        /** Storage form keeps the raw millis so the ISO string is rebuilt on send. */
        fun toStorageJson(e: GatewayEvent): String = e.toJson().put("timestampMs", e.timestampMs).toString()
    }
}
