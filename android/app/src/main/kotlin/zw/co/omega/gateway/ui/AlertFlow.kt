package zw.co.omega.gateway.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.text.InputType
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import zw.co.omega.gateway.R
import zw.co.omega.gateway.alerts.AlertSender
import zw.co.omega.gateway.data.Prefs

/**
 * The one guard-facing flow for sending an alert, shared by the dashboard and the Alerts screen so
 * EMERGENCY behaves identically wherever it is pressed:
 *
 *  tap → confirmation (the accidental-activation safeguard; one extra tap, no delay)
 *      → AlertSender.send (durable outbox, immediate sync, fresh GPS check in parallel)
 *      → plain feedback: delivered / saved on the phone / position attached or not
 *      → call offer when online, call-or-SMS fallback when offline.
 *
 * No second implementation: everything goes through AlertSender and the existing event types.
 */
object AlertFlow {
    fun interface Feedback { fun show(text: String, emergency: Boolean) }

    fun confirmEmergency(a: Activity, fb: Feedback) {
        AlertDialog.Builder(a)
            .setTitle(R.string.emergency_confirm_title)
            .setMessage(R.string.emergency_confirm_body)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.emergency_confirm_send) { _, _ -> send(a, AlertSender.Type.EMERGENCY, null, fb) }
            .show()
    }

    fun askMessage(a: Activity, type: AlertSender.Type, titleRes: Int, hintRes: Int, required: Boolean, fb: Feedback) {
        val input = EditText(a).apply { hint = a.getString(hintRes); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 2 }
        val wrap = FrameLayout(a).apply { setPadding(48, 16, 48, 0); addView(input) }
        val dialog = AlertDialog.Builder(a).setTitle(titleRes).setView(wrap).setNegativeButton(android.R.string.cancel, null).setPositiveButton(R.string.alert_send) { _, _ ->
            val text = input.text.toString().trim()
            if (required && text.isEmpty()) { askMessage(a, type, titleRes, hintRes, required, fb); return@setPositiveButton }
            send(a, type, text.ifEmpty { null }, fb)
        }.show()
        input.requestFocus()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    }

    fun send(a: Activity, type: AlertSender.Type, message: String?, fb: Feedback) {
        val prefs = Prefs(a)
        val r = AlertSender.send(a, type, message)
        val emergency = type == AlertSender.Type.EMERGENCY
        if (r.online) {
            fb.show(a.getString(if (emergency) R.string.alert_sent_emergency else R.string.alert_sent, a.getString(if (r.hadLocation) R.string.alert_with_position else R.string.alert_without_position)), emergency)
            if (emergency && prefs.opsPhone.isNotBlank()) {
                AlertDialog.Builder(a).setTitle(R.string.emergency_online_call_title).setMessage(a.getString(R.string.emergency_online_call_body, prefs.opsPhone)).setNegativeButton(R.string.alert_not_now, null).setPositiveButton(R.string.alert_call_ops) { _, _ -> callOps(a, fb) }.show()
            }
        } else {
            fb.show(a.getString(R.string.alert_saved_offline), emergency)
            val body = a.getString(R.string.alert_offline_body, if (prefs.opsPhone.isBlank()) a.getString(R.string.alert_no_ops_number) else prefs.opsPhone)
            val d = AlertDialog.Builder(a).setTitle(if (emergency) R.string.alert_offline_title_emergency else R.string.alert_offline_title).setMessage(body).setNeutralButton(R.string.alert_keep_trying, null)
            if (prefs.opsPhone.isNotBlank()) {
                d.setPositiveButton(R.string.alert_call_ops) { _, _ -> callOps(a, fb) }
                d.setNegativeButton(R.string.alert_sms_ops) { _, _ -> smsOps(a, type, fb) }
            }
            d.show()
        }
    }

    fun callOps(a: Activity, fb: Feedback) {
        val phone = Prefs(a).opsPhone
        if (phone.isBlank()) return
        try { a.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) } catch (e: Exception) { fb.show(a.getString(R.string.alert_dialer_missing), false) }
    }

    fun smsOps(a: Activity, type: AlertSender.Type, fb: Feedback) {
        val prefs = Prefs(a)
        if (prefs.opsPhone.isBlank()) return
        val keyword = when (type) { AlertSender.Type.EMERGENCY -> "EMERGENCY"; AlertSender.Type.NEED_ASSISTANCE -> "HELP"; AlertSender.Type.INCIDENT_REPORT, AlertSender.Type.SECURITY_ALERT -> "INCIDENT"; else -> "" }
        val body = "$keyword ${prefs.guardName}${prefs.dutySiteName.takeIf { it.isNotBlank() }?.let { " at $it" } ?: ""} (sent from the guard app while offline)".trim()
        try { a.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${prefs.opsPhone}")).putExtra("sms_body", body)) } catch (e: Exception) { fb.show(a.getString(R.string.alert_dialer_missing), false) }
    }
}
