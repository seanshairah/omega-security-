package zw.co.omega.gateway.net

import org.json.JSONArray
import org.json.JSONObject
import zw.co.omega.gateway.model.GatewayEvent
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Minimal JSON HTTP client for the backend. HTTPS is enforced for anything that is not localhost. */
class ApiClient(private val baseUrl: String, private val token: String? = null) {

    class ApiException(val status: Int, message: String) : IOException(message)

    data class Activation(val deviceId: String, val deviceToken: String, val deviceName: String, val phoneNumber: String, val locationName: String?, val heartbeatSeconds: Int, val mode: String, val guardName: String?, val opsPhone: String?)
    data class Heartbeat(val deviceName: String, val phoneNumber: String, val locationName: String?, val status: String, val heartbeatSeconds: Int, val mode: String, val guardName: String?, val opsPhone: String?, val alerts: JSONArray?, val commands: JSONArray? = null, val commandPollSeconds: Int = 30)
    data class Ack(val eventId: String, val status: String, val error: String?)

    fun activate(code: String, info: JSONObject): Activation {
        val body = JSONObject(info.toString()).put("activationCode", code.trim().uppercase())
        val r = post("/api/gateways/activate", body, auth = false)
        val loc = r.optJSONObject("location")
        return Activation(r.getString("deviceId"), r.getString("deviceToken"), r.optString("deviceName"), r.optString("phoneNumber"), loc?.optString("name"), r.optJSONObject("config")?.optInt("heartbeatSeconds", 120) ?: 120, r.optString("mode", "OPERATIONS_GATEWAY"), r.optJSONObject("guard")?.optString("name"), r.optJSONObject("config")?.optString("opsPhone")?.ifBlank { null })
    }

    fun heartbeat(info: JSONObject): Heartbeat {
        val r = post("/api/gateways/heartbeat", info)
        val loc = r.optJSONObject("location")
        return Heartbeat(r.optString("deviceName"), r.optString("phoneNumber"), loc?.optString("name"), r.optString("status"), r.optJSONObject("config")?.optInt("heartbeatSeconds", 120) ?: 120, r.optString("mode", "OPERATIONS_GATEWAY"), r.optJSONObject("guard")?.optString("name"), r.optJSONObject("config")?.optString("opsPhone")?.ifBlank { null }, r.optJSONArray("alerts"), r.optJSONArray("commands"), r.optInt("commandPollSeconds", 30))
    }

    /** GET /api/gateways/commands — operations commands addressed to this phone (REQUEST_LOCATION). */
    fun commands(): JSONObject = get("/api/gateways/commands")

    /** POST /api/gateways/commands/{id}/ack — "the GPS has started". The result itself travels as an event. */
    fun ackCommand(id: String, status: String, detail: String? = null): JSONObject = post("/api/gateways/commands/${java.net.URLEncoder.encode(id, "UTF-8")}/ack", JSONObject().put("status", status).apply { detail?.let { put("detail", it) } })

    /** GET /api/gateways/config — guard, shift, site, policy. */
    fun config(): JSONObject = get("/api/gateways/config")

    /**
     * HTTPS only. Debug builds additionally accept plain http:// for the emulator loopback hosts and
     * for the development allowlist (BuildConfig.DEV_HTTP_HOSTS, set from `omega.devHttpHosts` in
     * android/local.properties or GATEWAY_DEV_HTTP_HOSTS at build time, e.g. a laptop's LAN IP).
     * Release builds have an empty allowlist and refuse every cleartext URL; nothing here can widen that.
     */
    private fun requireHttps(url: URL) {
        if (url.protocol == "https") return
        if (zw.co.omega.gateway.BuildConfig.DEBUG && url.host in devHttpHosts()) return
        throw ApiException(0, "Server URL must use https://")
    }

    companion object {
        private val LOOPBACK = setOf("localhost", "127.0.0.1", "10.0.2.2")
        /** Hosts that may be reached over plain http in a debug build. Always empty in release. */
        fun devHttpHosts(): Set<String> = if (!zw.co.omega.gateway.BuildConfig.DEBUG) emptySet() else LOOPBACK + zw.co.omega.gateway.BuildConfig.DEV_HTTP_HOSTS.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
    }

    private fun get(path: String): JSONObject {
        val url = URL(baseUrl.trimEnd('/') + path)
        requireHttps(url)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "GET"; conn.connectTimeout = 15_000; conn.readTimeout = 20_000
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Authorization", "Bearer ${token ?: throw ApiException(401, "Device is not activated")}")
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (status !in 200..299) throw ApiException(status, json.optString("error").ifBlank { "HTTP $status" })
            return json
        } finally { conn.disconnect() }
    }

    fun sendEvents(events: List<GatewayEvent>): List<Ack> {
        val arr = JSONArray()
        events.forEach { arr.put(it.toJson()) }
        // The phone's clock as it sends: the server measures the offset from it, so a fix queued
        // during an outage keeps its real time and a wrong clock is corrected rather than trusted.
        val r = post("/api/gateways/events", JSONObject().put("events", arr).put("sentAt", GatewayEvent.iso(System.currentTimeMillis())))
        val acks = r.optJSONArray("acks") ?: JSONArray()
        return (0 until acks.length()).map { i -> val a = acks.getJSONObject(i); Ack(a.optString("eventId"), a.optString("status"), a.optString("error").ifBlank { null }) }
    }

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject {
        val url = URL(baseUrl.trimEnd('/') + path)
        requireHttps(url)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "SecurityGateway/Android")
            if (auth) {
                val t = token ?: throw ApiException(401, "Device is not activated")
                conn.setRequestProperty("Authorization", "Bearer $t")
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (status !in 200..299) throw ApiException(status, json.optString("error").ifBlank { "HTTP $status" })
            return json
        } finally {
            conn.disconnect()
        }
    }
}
