package zw.co.omega.gateway.service

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import zw.co.omega.gateway.GatewayApp
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.model.DeviceCommand
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.ui.CallConfirmActivity

/**
 * PLACE_CALL commands on an operations gateway phone.
 *
 * Android does not let an app in the background start a call, and this does not try to. It puts
 * the request in front of the operator, as a full-screen notification on a locked phone or a
 * heads-up one otherwise, and reports AWAITING_CONFIRMATION. The call itself starts only when the
 * operator taps Call on CallConfirmActivity. Whether it connected comes from the phone's own call
 * record, which CallMonitor already reports.
 */
class CallRequestHandler(private val context: Context, private val scope: CoroutineScope) {
    private val prefs = Prefs(context)

    fun handle(commands: List<DeviceCommand>) {
        for (c in commands) {
            if (c.type != DeviceCommand.PLACE_CALL) continue
            if (prefs.isCommandHandled(c.id)) continue
            prefs.markCommandHandled(c.id)
            scope.launch(Dispatchers.IO) {
                try { present(c) } catch (e: Exception) { Log.e(TAG, "call request ${c.id} failed: ${e.message}"); ack(c.id, "FAILED", "The phone could not show the request: ${e.javaClass.simpleName}") }
            }
        }
    }

    private fun present(c: DeviceCommand) {
        val number = c.phoneNumber
        if (prefs.isGuardMode) { ack(c.id, "FAILED", "This phone is in guard mode"); return }
        if (number.isNullOrBlank() || !VALID.matches(number)) { ack(c.id, "FAILED", "The number is not dialable"); return }
        if (c.isExpiredAt(System.currentTimeMillis())) return // the server already calls it timed out
        val open = CallConfirmActivity.intent(context, c)
        val pi = PendingIntent.getActivity(context, c.id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val who = c.guardName ?: number
        val n = NotificationCompat.Builder(context, GatewayApp.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle(context.getString(R.string.call_request_title, who))
            .setContentText(c.reason ?: context.getString(R.string.call_request_text))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setTimeoutAfter((c.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(5_000L))
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notificationId(c.id), n)
        ack(c.id, "AWAITING_CONFIRMATION", null)
    }

    private fun ack(id: String, status: String, detail: String?) {
        try { ApiClient(prefs.serverUrl, prefs.deviceToken).ackCommand(id, status, detail) }
        catch (e: Exception) { Log.w(TAG, "ack $status for $id failed: ${e.message}") }
    }

    companion object {
        private const val TAG = "CallRequestHandler"
        /** E.164 as the server normalises it: a plus and 9–15 digits. */
        val VALID = Regex("^\\+\\d{9,15}$")
        fun notificationId(id: String) = 4000 + (id.hashCode() and 0x0fff)
    }
}
