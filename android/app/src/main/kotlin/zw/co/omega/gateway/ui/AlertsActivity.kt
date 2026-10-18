package zw.co.omega.gateway.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import zw.co.omega.gateway.R
import zw.co.omega.gateway.alerts.AlertSender
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivityAlertsBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Guard communication: the emergency button, status quick actions, and the history of what was
 * sent with its delivery and acknowledgement state. Every action is saved on the phone first; the
 * guard is told plainly when it has not reached operations yet and is offered a call or SMS.
 */
class AlertsActivity : AppCompatActivity() {
    private lateinit var b: ActivityAlertsBinding
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { renderHistory(); handler.postDelayed(this, 4000) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        b = ActivityAlertsBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.back.setOnClickListener { finish() }
        b.emergency.setOnClickListener { confirmEmergency() }
        b.assistance.setOnClickListener { askMessage(AlertSender.Type.NEED_ASSISTANCE, R.string.alert_assistance, R.string.alert_msg_hint_optional) }
        b.incident.setOnClickListener { askMessage(AlertSender.Type.INCIDENT_REPORT, R.string.alert_incident, R.string.alert_msg_hint_required, required = true) }
        b.security.setOnClickListener { askMessage(AlertSender.Type.SECURITY_ALERT, R.string.alert_security, R.string.alert_msg_hint_required, required = true) }
        b.late.setOnClickListener { askMessage(AlertSender.Type.RUNNING_LATE, R.string.alert_late, R.string.alert_msg_hint_optional) }
        b.status.setOnClickListener { askMessage(AlertSender.Type.STATUS_UPDATE, R.string.alert_status, R.string.alert_msg_hint_required, required = true) }
        b.ok.setOnClickListener { send(AlertSender.Type.SHIFT_OK, null) }
        b.handover.setOnClickListener { askMessage(AlertSender.Type.HANDOVER, R.string.alert_handover, R.string.alert_msg_hint_optional) }
        b.callOps.setOnClickListener { callOps() }
        renderHistory()
        // Opened from a dashboard quick action: go straight to that action.
        when (intent.getStringExtra(EXTRA_ACTION)) {
            ACTION_EMERGENCY -> confirmEmergency()
            ACTION_ASSISTANCE -> askMessage(AlertSender.Type.NEED_ASSISTANCE, R.string.alert_assistance, R.string.alert_msg_hint_optional)
            ACTION_OK -> send(AlertSender.Type.SHIFT_OK, null)
        }
        intent.removeExtra(EXTRA_ACTION)
    }

    override fun onResume() { super.onResume(); handler.post(refresh) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(refresh) }

    private fun confirmEmergency() {
        AlertDialog.Builder(this)
            .setTitle(R.string.emergency_confirm_title)
            .setMessage(R.string.emergency_confirm_body)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.emergency_confirm_send) { _, _ -> send(AlertSender.Type.EMERGENCY, null) }
            .show()
    }

    private fun askMessage(type: AlertSender.Type, titleRes: Int, hintRes: Int, required: Boolean = false) {
        val input = EditText(this).apply { hint = getString(hintRes); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 2 }
        val wrap = FrameLayout(this).apply { setPadding(48, 16, 48, 0); addView(input) }
        val dialog = AlertDialog.Builder(this).setTitle(titleRes).setView(wrap).setNegativeButton(android.R.string.cancel, null).setPositiveButton(R.string.alert_send) { _, _ ->
            val text = input.text.toString().trim()
            if (required && text.isEmpty()) { askMessage(type, titleRes, hintRes, required); return@setPositiveButton }
            send(type, text.ifEmpty { null })
        }.show()
        input.requestFocus()
        dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    }

    private fun send(type: AlertSender.Type, message: String?) {
        val r = AlertSender.send(this, type, message)
        renderHistory()
        if (r.online) {
            b.feedback.text = getString(if (type == AlertSender.Type.EMERGENCY) R.string.alert_sent_emergency else R.string.alert_sent, if (r.hadLocation) getString(R.string.alert_with_position) else getString(R.string.alert_without_position))
            b.feedback.visibility = View.VISIBLE
            if (type == AlertSender.Type.EMERGENCY) offerCall(R.string.emergency_online_call_title, R.string.emergency_online_call_body)
        } else {
            // Saved on the phone, not delivered: say so plainly and offer the ways that still work without data.
            b.feedback.text = getString(R.string.alert_saved_offline)
            b.feedback.visibility = View.VISIBLE
            offerOfflineFallback(type)
        }
    }

    private fun offerCall(titleRes: Int, bodyRes: Int) {
        if (prefs.opsPhone.isBlank()) return
        AlertDialog.Builder(this).setTitle(titleRes).setMessage(getString(bodyRes, prefs.opsPhone)).setNegativeButton(R.string.alert_not_now, null).setPositiveButton(R.string.alert_call_ops) { _, _ -> callOps() }.show()
    }

    private fun offerOfflineFallback(type: AlertSender.Type) {
        val body = getString(R.string.alert_offline_body, if (prefs.opsPhone.isBlank()) getString(R.string.alert_no_ops_number) else prefs.opsPhone)
        val d = AlertDialog.Builder(this).setTitle(if (type == AlertSender.Type.EMERGENCY) R.string.alert_offline_title_emergency else R.string.alert_offline_title).setMessage(body).setNeutralButton(R.string.alert_keep_trying, null)
        if (prefs.opsPhone.isNotBlank()) {
            d.setPositiveButton(R.string.alert_call_ops) { _, _ -> callOps() }
            d.setNegativeButton(R.string.alert_sms_ops) { _, _ -> smsOps(type) }
        }
        d.show()
    }

    private fun callOps() {
        if (prefs.opsPhone.isBlank()) return
        try { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${prefs.opsPhone}"))) } catch (e: Exception) { b.feedback.text = getString(R.string.alert_dialer_missing) }
    }

    private fun smsOps(type: AlertSender.Type) {
        if (prefs.opsPhone.isBlank()) return
        val keyword = when (type) { AlertSender.Type.EMERGENCY -> "EMERGENCY"; AlertSender.Type.NEED_ASSISTANCE -> "HELP"; AlertSender.Type.INCIDENT_REPORT, AlertSender.Type.SECURITY_ALERT -> "INCIDENT"; else -> "" }
        val body = "$keyword ${prefs.guardName}${prefs.dutySiteName.takeIf { it.isNotBlank() }?.let { " at $it" } ?: ""} (sent from the guard app while offline)".trim()
        try { startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${prefs.opsPhone}")).putExtra("sms_body", body)) } catch (e: Exception) { b.feedback.text = getString(R.string.alert_dialer_missing) }
    }

    private fun renderHistory() {
        if (!::b.isInitialized) return
        val rows = EventQueue(this).recentComm(30, kind = "ALERT")
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.history.removeAllViews()
        if (rows.isEmpty()) { b.history.addView(TextView(this).apply { text = getString(R.string.alert_history_none); setTextColor(getColor(R.color.ink3)); textSize = 13f }); return }
        for (r in rows) {
            val title = TextView(this).apply { text = "${f.format(Date(r.at))} · ${labelFor(r.type)}${r.summary?.let { " · $it" } ?: ""}"; setTextColor(getColor(R.color.ink)); textSize = 14f; setPadding(0, 10, 0, 0) }
            val state = TextView(this).apply {
                text = when (r.status) {
                    "QUEUED" -> getString(R.string.alert_state_queued)
                    "SENT" -> getString(R.string.alert_state_sent, f.format(Date(r.sentAt ?: r.at)))
                    "ACKNOWLEDGED" -> getString(R.string.alert_state_acked, r.ackBy ?: "operations", r.ackAt?.let { f.format(Date(it)) } ?: "", r.ackNote?.let { " · “$it”" } ?: "")
                    "RESOLVED" -> getString(R.string.alert_state_resolved, r.ackBy ?: "operations", r.ackNote?.let { " · “$it”" } ?: "")
                    else -> getString(R.string.alert_state_failed, r.ackNote ?: "")
                }
                setTextColor(getColor(when (r.status) { "QUEUED" -> R.color.warn; "FAILED" -> R.color.critical; "ACKNOWLEDGED", "RESOLVED" -> R.color.accent_strong; else -> R.color.ink2 })); textSize = 12.5f
            }
            b.history.addView(title); b.history.addView(state)
        }
    }

    companion object {
        const val EXTRA_ACTION = "action"
        const val ACTION_EMERGENCY = "EMERGENCY"
        const val ACTION_ASSISTANCE = "ASSISTANCE"
        const val ACTION_OK = "OK"

        fun open(context: android.content.Context, action: String?) {
            context.startActivity(Intent(context, AlertsActivity::class.java).apply { action?.let { putExtra(EXTRA_ACTION, it) } })
        }

        fun labelFor(type: String): String = when (type) { "EMERGENCY" -> "EMERGENCY"; "NEED_ASSISTANCE" -> "Need assistance"; "INCIDENT_REPORT" -> "Incident report"; "SECURITY_ALERT" -> "Security alert"; "RUNNING_LATE" -> "Running late"; "STATUS_UPDATE" -> "Status update"; "SHIFT_OK" -> "Shift going well"; "HANDOVER" -> "Handover"; else -> type.lowercase().replace('_', ' ') }
    }
}
