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

    val isActivated: Boolean get() = !deviceToken.isNullOrBlank() && !deviceId.isNullOrBlank() && serverUrl.isNotBlank()

    /** Forget credentials. The server-side device is not touched; an admin revokes it there. */
    fun deactivate() {
        secure.edit().remove("deviceToken").apply()
        plain.edit().remove("deviceId").remove("lastSyncAt").remove("lastHeartbeatOk").remove("lastError").remove("authRejected").remove("shiftConfig").remove("monitoringState").remove("mode").remove("guardName").apply()
    }
}
