package zw.co.omega.gateway.model

import org.json.JSONArray
import org.json.JSONObject

/**
 * A command from operations, fetched with the heartbeat or from GET /api/gateways/commands.
 *
 * REQUEST_LOCATION (guard phone): measure and report a fresh fix. It never carries a coordinate.
 * PLACE_CALL (operations phone): show the operator who to call, and dial when they confirm.
 */
data class DeviceCommand(
    val id: String,
    val type: String,
    val requestedAtMs: Long,
    val expiresAtMs: Long,
    val maxAccuracyM: Float,
    val requireFreshFix: Boolean,
    val phoneNumber: String? = null,
    val guardName: String? = null,
    val reason: String? = null,
    val requestedBy: String? = null,
) {
    fun isExpiredAt(nowMs: Long) = nowMs >= expiresAtMs

    companion object {
        const val REQUEST_LOCATION = "REQUEST_LOCATION"
        const val PLACE_CALL = "PLACE_CALL"

        fun fromJson(o: JSONObject): DeviceCommand? {
            val id = o.optString("id").ifBlank { return null }
            val type = o.optString("type").ifBlank { return null }
            val expires = parseIso(o.optString("expiresAt")) ?: return null
            fun opt(k: String) = o.optString(k).takeIf { it.isNotBlank() && it != "null" }
            return DeviceCommand(id, type, parseIso(o.optString("requestedAt")) ?: System.currentTimeMillis(), expires, o.optDouble("maxAccuracyM", 100.0).toFloat().coerceIn(10f, 1000f), o.optBoolean("requireFreshFix", true),
                phoneNumber = opt("phoneNumber"), guardName = opt("guardName"), reason = opt("reason"), requestedBy = opt("requestedBy"))
        }

        fun listFromJson(arr: JSONArray?): List<DeviceCommand> = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(::fromJson) }

        fun parseIso(s: String?): Long? = s?.takeIf { it.isNotBlank() }?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
}
