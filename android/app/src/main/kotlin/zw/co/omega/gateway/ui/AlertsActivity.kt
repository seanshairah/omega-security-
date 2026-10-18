package zw.co.omega.gateway.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import zw.co.omega.gateway.R
import zw.co.omega.gateway.alerts.AlertSender
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.databinding.ActivityAlertsBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Guard communication: the emergency button, every status message, and the history of what was
 * sent with its delivery and acknowledgement state. All sending goes through AlertFlow/AlertSender.
 */
class AlertsActivity : AppCompatActivity() {
    private lateinit var b: ActivityAlertsBinding
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { renderHistory(); handler.postDelayed(this, 4000) } }
    private val fb = AlertFlow.Feedback { text, emergency ->
        b.feedback.text = text
        b.feedback.setBackgroundResource(if (emergency) R.drawable.bg_banner_red else R.drawable.bg_banner_green)
        b.feedback.visibility = View.VISIBLE
        renderHistory()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityAlertsBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.back.setOnClickListener { finish() }
        b.emergency.setOnClickListener { guard(it) { AlertFlow.confirmEmergency(this, fb) } }
        b.assistance.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.NEED_ASSISTANCE, R.string.alert_assistance, R.string.alert_msg_hint_optional, false, fb) } }
        b.incident.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.INCIDENT_REPORT, R.string.alert_incident, R.string.alert_msg_hint_required, true, fb) } }
        b.security.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.SECURITY_ALERT, R.string.alert_security, R.string.alert_msg_hint_required, true, fb) } }
        b.late.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.RUNNING_LATE, R.string.alert_late, R.string.alert_msg_hint_optional, false, fb) } }
        b.status.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.STATUS_UPDATE, R.string.alert_status, R.string.alert_msg_hint_required, true, fb) } }
        b.ok.setOnClickListener { guard(it) { AlertFlow.send(this, AlertSender.Type.SHIFT_OK, null, fb) } }
        b.handover.setOnClickListener { guard(it) { AlertFlow.askMessage(this, AlertSender.Type.HANDOVER, R.string.alert_handover, R.string.alert_msg_hint_optional, false, fb) } }
        b.callOps.setOnClickListener { AlertFlow.callOps(this, fb) }
        renderHistory()
        // Opened from a dashboard quick action: go straight to that action.
        when (intent.getStringExtra(EXTRA_ACTION)) {
            ACTION_EMERGENCY -> AlertFlow.confirmEmergency(this, fb)
            ACTION_ASSISTANCE -> AlertFlow.askMessage(this, AlertSender.Type.NEED_ASSISTANCE, R.string.alert_assistance, R.string.alert_msg_hint_optional, false, fb)
            ACTION_OK -> AlertFlow.send(this, AlertSender.Type.SHIFT_OK, null, fb)
        }
        intent.removeExtra(EXTRA_ACTION)
    }

    override fun onResume() { super.onResume(); handler.post(refresh) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(refresh) }

    /** A nervous double-tap must not send twice: the row is disabled for 2.5 s after a tap. */
    private fun guard(v: View, action: () -> Unit) { v.isEnabled = false; handler.postDelayed({ v.isEnabled = true }, 2500); action() }

    private fun renderHistory() {
        if (!::b.isInitialized) return
        val rows = EventQueue(this).recentComm(30, kind = "ALERT")
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.history.removeAllViews()
        if (rows.isEmpty()) { b.history.addView(TextView(this).apply { text = getString(R.string.alert_history_none); setTextColor(getColor(R.color.ink3)); textSize = 14f; setPadding(0, 8, 0, 0) }); return }
        for (r in rows) {
            val title = TextView(this).apply { text = "${f.format(Date(r.at))} · ${labelFor(r.type)}${r.summary?.let { " · $it" } ?: ""}"; setTextColor(getColor(if (r.type == "EMERGENCY") R.color.critical else R.color.ink)); textSize = 15f; setPadding(0, 14, 0, 0); setTypeface(typeface, android.graphics.Typeface.BOLD) }
            val state = TextView(this).apply {
                text = commStateText(this@AlertsActivity, r)
                setTextColor(getColor(commStateColour(r))); textSize = 13f; setPadding(0, 2, 0, 0)
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

        fun labelFor(type: String): String = when (type) { "EMERGENCY" -> "EMERGENCY"; "NEED_ASSISTANCE" -> "Need assistance"; "INCIDENT_REPORT" -> "Incident report"; "SECURITY_ALERT" -> "Security alert"; "RUNNING_LATE" -> "Running late"; "STATUS_UPDATE" -> "Status update"; "SHIFT_OK" -> "Shift going well"; "HANDOVER" -> "Handover"; "LOCATION_REQUEST" -> "Operations asked for your position"; "LOCATION_REQUEST_RESULT" -> "Position sent"; else -> type.lowercase().replace('_', ' ') }

        /** Delivery / acknowledgement wording shared by the dashboard and the Alerts screen. */
        fun commStateText(ctx: android.content.Context, r: EventQueue.CommRow): String {
            val f = SimpleDateFormat("HH:mm", Locale.getDefault())
            return when (r.status) {
                "QUEUED" -> ctx.getString(R.string.alert_state_queued)
                "SENT" -> if (r.kind == "ALERT") ctx.getString(R.string.alert_state_sent, f.format(Date(r.sentAt ?: r.at))) else ctx.getString(R.string.delivery_sent, f.format(Date(r.sentAt ?: r.at)))
                "ACKNOWLEDGED" -> ctx.getString(R.string.alert_state_acked, r.ackBy ?: "operations", r.ackAt?.let { f.format(Date(it)) } ?: "", r.ackNote?.let { " · “$it”" } ?: "")
                "RESOLVED" -> ctx.getString(R.string.alert_state_resolved, r.ackBy ?: "operations", r.ackNote?.let { " · “$it”" } ?: "")
                else -> ctx.getString(R.string.alert_state_failed, r.ackNote ?: "")
            }
        }

        fun commStateColour(r: EventQueue.CommRow): Int = when (r.status) { "QUEUED" -> R.color.warn_strong; "FAILED" -> R.color.critical; "ACKNOWLEDGED", "RESOLVED" -> R.color.accent_strong; else -> R.color.ink2 }
    }
}
