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
        b.back.setOnClickListener { finish() }
        b.test.setOnClickListener { testConnection() }
        b.deactivate.setOnClickListener { confirmDeactivate() }
        render()
    }

    private fun render() {
        b.serverUrl.text = prefs.serverUrl
        b.deviceId.text = prefs.deviceId ?: "—"
        b.appVersion.text = DeviceInfo.appVersion()
        b.android.text = "${DeviceInfo.androidVersion()} · ${DeviceInfo.model()}"
        b.heartbeat.text = getString(R.string.every_seconds, prefs.heartbeatSeconds)
        b.queue.text = EventQueue(this).size().toString()
        b.gatewayStatus.text = when { prefs.authRejected -> getString(R.string.status_rejected); prefs.lastHeartbeatOk -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.lastError.text = prefs.lastError ?: getString(R.string.none)
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
