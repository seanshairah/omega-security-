package zw.co.omega.gateway.util

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import org.json.JSONObject
import zw.co.omega.gateway.BuildConfig

object DeviceInfo {
    fun batteryLevel(context: Context): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val level = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        if (level in 0..100) return level
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
        val l = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val s = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (l >= 0 && s > 0) (l * 100 / s) else -1
    }

    /** "mobile", "wifi", "ethernet", "none" */
    fun networkType(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun appVersion(): String = BuildConfig.VERSION_NAME
    fun androidVersion(): String = "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    fun model(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    fun json(context: Context): JSONObject = JSONObject()
        .put("appVersion", appVersion())
        .put("androidVersion", androidVersion())
        .put("deviceModel", model())
        .put("batteryLevel", batteryLevel(context))
        .put("networkType", networkType(context))
        .put("timestamp", zw.co.omega.gateway.model.GatewayEvent.iso(System.currentTimeMillis()))
}
