package zw.co.omega.gateway.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.service.GatewayService

/** Manifest-declared backup receiver: fires even if the service was killed, and restarts it. */
class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        if (!prefs.isActivated) return
        when (intent.action) {
            TelephonyManager.ACTION_PHONE_STATE_CHANGED -> CallMonitor.onPhoneState(context, CallMonitor.extraState(intent), CallMonitor.extraNumber(intent))
            @Suppress("DEPRECATION") Intent.ACTION_NEW_OUTGOING_CALL -> CallMonitor.onOutgoing(context, intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER))
        }
        GatewayService.start(context)
    }
}
