package zw.co.omega.gateway

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.service.GatewayService

class GatewayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_STATUS, "Gateway status", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps the Security Gateway running in the background"
                setShowBadge(false)
            })
        }
        // If the phone is activated, make sure the service is up whenever the process starts.
        if (Prefs(this).isActivated) GatewayService.start(this)
    }

    companion object {
        const val CHANNEL_STATUS = "gateway_status"
    }
}
