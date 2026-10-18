package zw.co.omega.gateway.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Device configuration and credentials. The device token lives in EncryptedSharedPreferences
 * (AES-256 keys in the Android Keystore); nothing is hard-coded in the APK.
 */
class Prefs(context: Context) {
    private val app = context.applicationContext
    private val secure: SharedPreferences = try {
        val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(app, "gateway_secure", key, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    } catch (e: Exception) {
        // Keystore unavailable (rare, damaged key). Fall back to plain prefs rather than crash; token is re-issued on re-activation.
        app.getSharedPreferences("gateway_secure_fallback", Context.MODE_PRIVATE)
    }
    private val plain: SharedPreferences = app.getSharedPreferences("gateway", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = plain.getString("serverUrl", "") ?: ""
        set(v) = plain.edit().putString("serverUrl", v.trim().trimEnd('/')).apply()

    var deviceToken: String?
        get() = secure.getString("deviceToken", null)
        set(v) = secure.edit().putString("deviceToken", v).apply()

    var deviceId: String?
        get() = plain.getString("deviceId", null)
        set(v) = plain.edit().putString("deviceId", v).apply()

    var deviceName: String
        get() = plain.getString("deviceName", "") ?: ""
        set(v) = plain.edit().putString("deviceName", v).apply()

    var phoneNumber: String
        get() = plain.getString("phoneNumber", "") ?: ""
        set(v) = plain.edit().putString("phoneNumber", v).apply()

    var locationName: String
        get() = plain.getString("locationName", "") ?: ""
        set(v) = plain.edit().putString("locationName", v).apply()

    var heartbeatSeconds: Int
        get() = plain.getInt("heartbeatSeconds", 120)
        set(v) = plain.edit().putInt("heartbeatSeconds", v.coerceIn(30, 3600)).apply()

    var lastSyncAt: Long
        get() = plain.getLong("lastSyncAt", 0L)
        set(v) = plain.edit().putLong("lastSyncAt", v).apply()

    var lastHeartbeatOk: Boolean
        get() = plain.getBoolean("lastHeartbeatOk", false)
        set(v) = plain.edit().putBoolean("lastHeartbeatOk", v).apply()

    var lastError: String?
        get() = plain.getString("lastError", null)
        set(v) = plain.edit().putString("lastError", v).apply()

    var lastCallSummary: String?
        get() = plain.getString("lastCallSummary", null)
        set(v) = plain.edit().putString("lastCallSummary", v).apply()

    var lastCallAt: Long
        get() = plain.getLong("lastCallAt", 0L)
        set(v) = plain.edit().putLong("lastCallAt", v).apply()

    /** Set by the server when it rejects the token (revoked/disabled); shown on screen. */
    var authRejected: Boolean
        get() = plain.getBoolean("authRejected", false)
        set(v) = plain.edit().putBoolean("authRejected", v).apply()

    /** OPERATIONS_GATEWAY or GUARD, decided by the server at activation. */
    var mode: String
        get() = plain.getString("mode", "OPERATIONS_GATEWAY") ?: "OPERATIONS_GATEWAY"
        set(v) = plain.edit().putString("mode", v).apply()
    val isGuardMode: Boolean get() = mode == "GUARD"

    var guardName: String
        get() = plain.getString("guardName", "") ?: ""
        set(v) = plain.edit().putString("guardName", v).apply()

    var monitoringState: String
        get() = plain.getString("monitoringState", "NOT_ON_SHIFT") ?: "NOT_ON_SHIFT"
        set(v) = plain.edit().putString("monitoringState", v).apply()

    var lastFixLat: Double
        get() = Double.fromBits(plain.getLong("lastFixLat", 0L))
        set(v) = plain.edit().putLong("lastFixLat", v.toRawBits()).apply()
    var lastFixLng: Double
        get() = Double.fromBits(plain.getLong("lastFixLng", 0L))
        set(v) = plain.edit().putLong("lastFixLng", v.toRawBits()).apply()
    var lastFixAccuracy: Float
        get() = plain.getFloat("lastFixAcc", 0f)
        set(v) = plain.edit().putFloat("lastFixAcc", v).apply()
    var lastFixAt: Long
        get() = plain.getLong("lastFixAt", 0L)
        set(v) = plain.edit().putLong("lastFixAt", v).apply()
    var lastFixState: String
        get() = plain.getString("lastFixState", "UNKNOWN") ?: "UNKNOWN"
        set(v) = plain.edit().putString("lastFixState", v).apply()
    var lastFixDistanceM: Float
        get() = plain.getFloat("lastFixDistance", -1f)
        set(v) = plain.edit().putFloat("lastFixDistance", v).apply()
    var lastCheckAt: Long
        get() = plain.getLong("lastCheckAt", 0L)
        set(v) = plain.edit().putLong("lastCheckAt", v).apply()
    var mockSeen: Boolean
        get() = plain.getBoolean("mockSeen", false)
        set(v) = plain.edit().putBoolean("mockSeen", v).apply()
    var onboardingDone: Boolean
        get() = plain.getBoolean("onboardingDone", false)
        set(v) = plain.edit().putBoolean("onboardingDone", v).apply()

    // ---- Separate states (Stage 1): shift, GPS and sync are three different facts ----
    /** NONE | UPCOMING | ACTIVE — whether there is a shift to monitor right now. */
    var shiftState: String
        get() = plain.getString("shiftState", "NONE") ?: "NONE"
        set(v) = plain.edit().putString("shiftState", v).apply()
    /** Phase of the geofence state machine for the current shift (MONITORING, VERIFYING_OUTSIDE, OUTSIDE, LOCATION_UNAVAILABLE) or OFF. */
    var gpsState: String
        get() = plain.getString("gpsState", "OFF") ?: "OFF"
        set(v) = plain.edit().putString("gpsState", v).apply()
    /** Why the last reading was UNKNOWN: no_fix, poor_accuracy, location_disabled, permission_revoked, site_has_no_coordinates, on_boundary. */
    var gpsReason: String?
        get() = plain.getString("gpsReason", null)
        set(v) = plain.edit().putString("gpsReason", v).apply()
    /** True while a location acquisition is running (dashboard shows CHECKING…). */
    var gpsChecking: Boolean
        get() = plain.getBoolean("gpsChecking", false)
        set(v) = plain.edit().putBoolean("gpsChecking", v).apply()
    /** When the last check was *attempted*, fix or not. `lastCheckAt` is when an observation was recorded. */
    var lastAttemptAt: Long
        get() = plain.getLong("lastAttemptAt", 0L)
        set(v) = plain.edit().putLong("lastAttemptAt", v).apply()
    /** Heartbeats and event syncs are different things; each has its own timestamp. */
    var lastHeartbeatAt: Long
        get() = plain.getLong("lastHeartbeatAt", 0L)
        set(v) = plain.edit().putLong("lastHeartbeatAt", v).apply()
    /** Name of the duty site of the shift being monitored (not the device's registration location). */
    var dutySiteName: String
        get() = plain.getString("dutySiteName", "") ?: ""
        set(v) = plain.edit().putString("dutySiteName", v).apply()

    // ---- Sync engine (Stage 3) ----
    /** SYNCED | SENDING | QUEUED | QUEUED_OFFLINE | RETRY_PENDING | SYNCED_WITH_FAILURES | REVOKED (see SyncPlanner.syncState). */
    var syncState: String
        get() = plain.getString("syncState", "SYNCED") ?: "SYNCED"
        set(v) = plain.edit().putString("syncState", v).apply()
    var lastSyncError: String?
        get() = plain.getString("lastSyncError", null)
        set(v) = plain.edit().putString("lastSyncError", v).apply()
    var lastSyncAttemptAt: Long
        get() = plain.getLong("lastSyncAttemptAt", 0L)
        set(v) = plain.edit().putLong("lastSyncAttemptAt", v).apply()
    var lastSyncTrigger: String?
        get() = plain.getString("lastSyncTrigger", null)
        set(v) = plain.edit().putString("lastSyncTrigger", v).apply()

    /** True while routine checks are stretched because the battery is low (dashboard says so). */
    var batterySaver: Boolean
        get() = plain.getBoolean("batterySaver", false)
        set(v) = plain.edit().putBoolean("batterySaver", v).apply()

    /** Control-room number from the server config: the fallback when an alert cannot reach operations. */
    var opsPhone: String
        get() = plain.getString("opsPhone", "") ?: ""
        set(v) = plain.edit().putString("opsPhone", v).apply()

    val isActivated: Boolean get() = !deviceToken.isNullOrBlank() && !deviceId.isNullOrBlank() && serverUrl.isNotBlank()

    /** Forget credentials. The server-side device is not touched; an admin revokes it there. */
    fun deactivate() {
        secure.edit().remove("deviceToken").apply()
        plain.edit().remove("deviceId").remove("lastSyncAt").remove("lastHeartbeatOk").remove("lastError").remove("authRejected").remove("shiftConfig").remove("monitoringState").remove("mode").remove("guardName")
            .remove("shiftState").remove("gpsState").remove("gpsReason").remove("gpsChecking").remove("lastAttemptAt").remove("lastHeartbeatAt").remove("dutySiteName").remove("onboardingDone").remove("syncState").remove("lastSyncError").remove("lastSyncAttemptAt").remove("lastSyncTrigger").apply()
    }
}
