package zw.co.omega.gateway.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivitySettingsBinding
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.SyncEngine
import zw.co.omega.gateway.service.SyncWorker
import zw.co.omega.gateway.util.DeviceInfo

/** Diagnostics and the few settings an operator needs. */
class SettingsActivity : AppCompatActivity() {
    private lateinit var b: ActivitySettingsBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)
        Insets.applySystemBars(b.root)
        b.back.setOnClickListener { finish() }
        b.test.setOnClickListener { testConnection() }
        b.deactivate.setOnClickListener { confirmDeactivate() }
        b.syncNow.setOnClickListener { GatewayService.requestSync(this, zw.co.omega.gateway.service.Trigger.MANUAL); b.syncNow.isEnabled = false; b.root.postDelayed({ b.syncNow.isEnabled = true; render() }, 3000) }
        render()
    }

    override fun onResume() { super.onResume(); render() }

    private fun render() {
        val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
        val bat = DeviceInfo.batteryLevel(this)
        val bgAllowed = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M && pm.isIgnoringBatteryOptimizations(packageName)
        b.deviceName.text = prefs.deviceName.ifBlank { "—" }
        b.deviceLine.text = getString(R.string.device_line, prefs.phoneNumber.ifBlank { "—" }, prefs.locationName.ifBlank { getString(R.string.head_office) }, DeviceInfo.appVersion())
        b.healthLine.text = getString(R.string.health_line, if (bat >= 0) "$bat%" else "—", if (prefs.batterySaver) getString(R.string.health_saver) else "", if (bgAllowed) getString(R.string.health_bg_ok) else getString(R.string.health_bg_restricted), DeviceInfo.model())
        b.serverUrl.text = prefs.serverUrl
        b.deviceId.text = prefs.deviceId ?: "—"
        b.appVersion.text = DeviceInfo.appVersion()
        b.android.text = "${DeviceInfo.androidVersion()} · ${DeviceInfo.model()}"
        b.heartbeat.text = getString(R.string.every_seconds, prefs.heartbeatSeconds)
        b.queue.text = EventQueue.get(this).size().toString()
        b.gatewayStatus.text = when { prefs.authRejected -> getString(R.string.status_rejected); prefs.lastHeartbeatOk -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.lastError.text = prefs.lastError ?: getString(R.string.none)
        // Sync diagnostics: what is waiting, why, and the last runs.
        val q = EventQueue.get(this)
        val c = q.counts()
        val f = java.text.SimpleDateFormat("dd MMM HH:mm:ss", java.util.Locale.getDefault())
        val nextRetry = q.nextAttemptAt()?.takeIf { it > System.currentTimeMillis() }?.let { f.format(java.util.Date(it)) }
        b.syncSummary.text = getString(R.string.sync_summary, prefs.syncState, c.queued, c.sending, c.retryPending, c.failed,
            if (prefs.lastSyncAt > 0) f.format(java.util.Date(prefs.lastSyncAt)) else "—",
            if (prefs.lastSyncAttemptAt > 0) "${f.format(java.util.Date(prefs.lastSyncAttemptAt))} (${prefs.lastSyncTrigger ?: "?"})" else "—",
            nextRetry ?: "—", prefs.lastSyncError ?: getString(R.string.none))
        val rows = q.recentLog(15)
        b.syncHistory.text = if (rows.isEmpty()) getString(R.string.sync_history_none) else rows.joinToString("\n") { r ->
            "${f.format(java.util.Date(r.at))} · ${r.trigger.lowercase()} · ${if (r.online) "online" else "offline"} · sent ${r.sent} ok ${r.acked}${if (r.duplicates > 0) " dup ${r.duplicates}" else ""}${if (r.rejected > 0) " rejected ${r.rejected}" else ""}${if (r.retried > 0) " retry ${r.retried}" else ""} · ${r.durationMs} ms${r.error?.let { " · $it" } ?: ""}"
        }
    }

    private fun testConnection() {
        b.test.isEnabled = false
        b.testResult.text = getString(R.string.testing)
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { SyncEngine(this@SettingsActivity).heartbeat() }
            b.testResult.text = when (r) {
                is SyncEngine.Outcome.Done -> getString(R.string.test_ok)
                is SyncEngine.Outcome.Retry -> getString(R.string.test_fail, r.error)
                is SyncEngine.Outcome.Rejected -> getString(R.string.test_rejected, r.error)
            }
            b.test.isEnabled = true
            render()
        }
    }

    private fun confirmDeactivate() {
        AlertDialog.Builder(this)
            .setTitle(R.string.deactivate_title)
            .setMessage(R.string.deactivate_body)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.deactivate) { _, _ ->
                GatewayService.stop(this)
                SyncWorker.cancel(this)
                prefs.deactivate()
                startActivity(Intent(this, ActivationActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
            }
            .show()
    }
}
