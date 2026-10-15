package zw.co.omega.gateway.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import zw.co.omega.gateway.BuildConfig
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivityActivationBinding
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.SyncWorker
import zw.co.omega.gateway.util.DeviceInfo

/** First screen: server address and the activation code shown in the portal. */
class ActivationActivity : AppCompatActivity() {
    private lateinit var b: ActivityActivationBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (prefs.isActivated) { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        b = ActivityActivationBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.server.setText(prefs.serverUrl.ifBlank { BuildConfig.DEFAULT_SERVER_URL })
        b.version.text = getString(R.string.version_line, DeviceInfo.appVersion())
        b.activate.setOnClickListener { activate() }
    }

    private fun activate() {
        val server = b.server.text.toString().trim().trimEnd('/')
        val code = b.code.text.toString().trim().uppercase()
        if (!server.startsWith("http")) { b.error.text = getString(R.string.err_server); return }
        if (code.length < 6) { b.error.text = getString(R.string.err_code); return }
        b.error.text = ""
        b.activate.isEnabled = false
        b.activate.text = getString(R.string.activating)
        lifecycleScope.launch {
            try {
                val r = withContext(Dispatchers.IO) { ApiClient(server).activate(code, DeviceInfo.json(this@ActivationActivity)) }
                prefs.serverUrl = server
                prefs.deviceId = r.deviceId
                prefs.deviceToken = r.deviceToken
                prefs.deviceName = r.deviceName
                prefs.phoneNumber = r.phoneNumber
                prefs.locationName = r.locationName ?: ""
                prefs.mode = r.mode
                prefs.guardName = r.guardName ?: ""
                prefs.heartbeatSeconds = r.heartbeatSeconds
                prefs.lastHeartbeatOk = true
                prefs.lastSyncAt = System.currentTimeMillis()
                prefs.authRejected = false
                GatewayService.start(this@ActivationActivity)
                SyncWorker.schedule(this@ActivationActivity)
                Toast.makeText(this@ActivationActivity, getString(R.string.activated_as, r.deviceName), Toast.LENGTH_LONG).show()
                startActivity(Intent(this@ActivationActivity, if (prefs.isGuardMode && !prefs.onboardingDone) PermissionsActivity::class.java else MainActivity::class.java))
                finish()
            } catch (e: ApiClient.ApiException) {
                b.error.text = e.message
            } catch (e: Exception) {
                b.error.text = getString(R.string.err_network, e.message ?: "")
            } finally {
                b.activate.isEnabled = true
                b.activate.text = getString(R.string.activate_device)
            }
        }
    }
}
