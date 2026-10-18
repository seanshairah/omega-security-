package zw.co.omega.gateway.data

import android.content.Context
import org.json.JSONObject
import zw.co.omega.gateway.geofence.Policy
import zw.co.omega.gateway.geofence.Site

/** The shift the phone should monitor, cached from GET /api/gateways/config so monitoring works offline. */
data class ShiftConfig(val shiftId: String, val startAtMs: Long, val endAtMs: Long, val status: String, val site: Site?, val policy: Policy, val guardName: String?, val fetchedAtMs: Long) {
    fun isActiveAt(now: Long): Boolean = now >= startAtMs - 10 * 60_000L && now <= endAtMs + 30 * 60_000L && status !in setOf("COMPLETED", "MISSED", "CANCELLED")
    fun isUpcomingAt(now: Long): Boolean = now < startAtMs - 10 * 60_000L

    fun toJson(): JSONObject = JSONObject().apply {
        put("shiftId", shiftId); put("startAtMs", startAtMs); put("endAtMs", endAtMs); put("status", status); put("guardName", guardName ?: JSONObject.NULL); put("fetchedAtMs", fetchedAtMs)
        site?.let { put("site", JSONObject().put("id", it.id).put("name", it.name).put("latitude", it.latitude).put("longitude", it.longitude).put("radiusM", it.radiusM)) }
        put("policy", JSONObject().put("checkMinutes", policy.checkMinutes).put("verifySeconds", policy.verifySeconds).put("outsideCheckMinutes", policy.outsideCheckMinutes).put("accuracyMaxM", policy.accuracyMaxM))
    }

    companion object {
        private const val KEY = "shiftConfig"

        fun fromJson(o: JSONObject): ShiftConfig {
            val s = o.optJSONObject("site")
            val p = o.optJSONObject("policy") ?: JSONObject()
            return ShiftConfig(
                o.getString("shiftId"), o.getLong("startAtMs"), o.getLong("endAtMs"), o.optString("status", "SCHEDULED"),
                if (s != null && s.has("latitude") && !s.isNull("latitude")) Site(s.getString("id"), s.optString("name"), s.getDouble("latitude"), s.getDouble("longitude"), s.optInt("radiusM", 150)) else null,
                Policy(p.optInt("checkMinutes", 10), p.optInt("verifySeconds", 60), p.optInt("outsideCheckMinutes", 3), p.optInt("accuracyMaxM", 100)),
                o.optString("guardName").ifBlank { null }, o.optLong("fetchedAtMs", 0L),
            )
        }

        /** Parse the server's config response. Returns null when there is no shift. */
        fun fromServer(r: JSONObject): ShiftConfig? {
            val shift = r.optJSONObject("shift") ?: return null
            val cfg = r.optJSONObject("config") ?: JSONObject()
            val gf = cfg.optJSONObject("geofence") ?: JSONObject()
            val site = shift.optJSONObject("site")
            val iso = { s: String -> java.time.Instant.parse(s).toEpochMilli() }
            return ShiftConfig(
                shift.getString("id"), iso(shift.getString("startAt")), iso(shift.getString("endAt")), shift.optString("status", "SCHEDULED"),
                if (site != null && site.optBoolean("hasCoordinates", false)) Site(site.getString("id"), site.optString("name"), site.getDouble("latitude"), site.getDouble("longitude"), site.optInt("radiusM", 150)) else null,
                Policy(gf.optInt("checkMinutes", 10), gf.optInt("verifySeconds", 60), gf.optInt("outsideCheckMinutes", 3), gf.optInt("accuracyMaxM", 100)),
                r.optJSONObject("guard")?.optString("name"), System.currentTimeMillis(),
            )
        }

        fun load(context: Context): ShiftConfig? = context.getSharedPreferences("gateway", Context.MODE_PRIVATE).getString(KEY, null)?.let { runCatching { fromJson(JSONObject(it)) }.getOrNull() }
        /** Persist the config and, when anything other than the fetch time changed, wake the monitoring coordinator. */
        fun save(context: Context, c: ShiftConfig?) {
            val prefs = context.getSharedPreferences("gateway", Context.MODE_PRIVATE)
            val before = load(context)
            prefs.edit().apply { if (c == null) remove(KEY) else putString(KEY, c.toJson().toString()) }.apply()
            if (fingerprint(before) != fingerprint(c)) ConfigBus.notifyChanged()
        }

        /** Everything that matters for monitoring; `fetchedAtMs` is deliberately left out. */
        fun fingerprint(c: ShiftConfig?): String = c?.copy(fetchedAtMs = 0L)?.toJson()?.toString() ?: "none"
    }
}
