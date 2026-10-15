package zw.co.omega.gateway.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import zw.co.omega.gateway.R
import zw.co.omega.gateway.call.CallMonitor
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivityMainBinding
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.util.DeviceInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The dashboard: is the gateway online, what is it, and what happened last. */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { render(); handler.postDelayed(this, 5000) } }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { render(); GatewayService.start(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.isActivated) { startActivity(Intent(this, ActivationActivity::class.java)); finish(); return }
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.settings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.permissions.setOnClickListener { requestPermissions() }
        b.battery.setOnClickListener { requestIgnoreBatteryOptimisations() }
        b.syncNow.setOnClickListener { GatewayService.requestHeartbeat(this); GatewayService.requestSync(this); if (prefs.isGuardMode) GatewayService.requestLocationCheck(this); handler.postDelayed({ render() }, 2500) }
        if (prefs.isGuardMode && !prefs.onboardingDone) { startActivity(Intent(this, PermissionsActivity::class.java)); return }
        requestPermissions()
    }

    override fun onResume() { super.onResume(); GatewayService.start(this); handler.post(refresh) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(refresh) }

    private fun requestPermissions() {
        if (prefs.isGuardMode) { startActivity(Intent(this, PermissionsActivity::class.java)); return }
        val wanted = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray())
    }

    private fun requestIgnoreBatteryOptimisations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); return }
        try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
        catch (e: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }

    private fun render() {
        if (!::b.isInitialized) return
        val online = prefs.lastHeartbeatOk && !prefs.authRejected && DeviceInfo.isOnline(this)
        val canMonitor = CallMonitor.canMonitor(this)
        val canNumbers = CallMonitor.canSeeNumbers(this)
        b.statusDot.text = when { prefs.authRejected -> "🔴"; online -> "🟢"; else -> "🔴" }
        b.statusWord.text = when { prefs.authRejected -> getString(R.string.status_rejected); online -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.deviceName.text = prefs.deviceName.ifBlank { "—" }
        b.location.text = prefs.locationName.ifBlank { getString(R.string.head_office) }
        b.phone.text = prefs.phoneNumber.ifBlank { "—" }
        b.lastSync.text = fmt(prefs.lastSyncAt)
        val bat = DeviceInfo.batteryLevel(this)
        b.batteryLevel.text = if (bat >= 0) "$bat%" else "—"
        b.network.text = when (DeviceInfo.networkType(this)) { "mobile" -> getString(R.string.net_mobile); "wifi" -> getString(R.string.net_wifi); "none" -> getString(R.string.net_none); else -> getString(R.string.net_other) }
        b.appVersion.text = DeviceInfo.appVersion()
        b.lastCall.text = prefs.lastCallSummary?.let { "$it\n${fmt(prefs.lastCallAt)}" } ?: getString(R.string.no_calls_yet)
        // Guard mode rows
        val guard = prefs.isGuardMode
        b.guardRows.visibility = if (guard) android.view.View.VISIBLE else android.view.View.GONE
        b.modeLine.text = if (guard) getString(R.string.mode_guard, prefs.guardName.ifBlank { "—" }) else getString(R.string.mode_ops)
        if (guard) {
            val cfg = zw.co.omega.gateway.data.ShiftConfig.load(this)
            val now = System.currentTimeMillis()
            b.shiftLine.text = when { cfg == null -> getString(R.string.shift_none); cfg.isActiveAt(now) -> getString(R.string.shift_active, cfg.site?.name ?: "—", fmt(cfg.startAtMs), fmt(cfg.endAtMs), cfg.site?.radiusM ?: 0); cfg.isUpcomingAt(now) -> getString(R.string.shift_upcoming, cfg.site?.name ?: "—", fmt(cfg.startAtMs)); else -> getString(R.string.shift_none) }
            b.monitoringLine.text = when (prefs.monitoringState) { "MONITORING", "INSIDE" -> getString(R.string.mon_inside); "VERIFYING_OUTSIDE" -> getString(R.string.mon_verifying); "OUTSIDE" -> getString(R.string.mon_outside); "LOCATION_UNAVAILABLE" -> getString(R.string.mon_unavailable); "OFFLINE_MONITORING" -> getString(R.string.mon_offline); "WAITING_FOR_SHIFT" -> getString(R.string.mon_waiting); else -> getString(R.string.mon_off) }
            b.lastCheckLine.text = if (prefs.lastCheckAt > 0) getString(R.string.last_check, fmt(prefs.lastCheckAt), prefs.lastFixState, if (prefs.lastFixDistanceM >= 0) "${prefs.lastFixDistanceM.toInt()} m" else "—", prefs.lastFixAccuracy.toInt()) else getString(R.string.last_check_none)
            b.locationPermLine.text = when (DeviceInfo.locationPermission(this)) { "background" -> getString(R.string.perm_bg); "foreground_only" -> getString(R.string.perm_fg); else -> getString(R.string.perm_denied) }
        }
        val queued = EventQueue(this).size()
        b.connection.text = when {
            prefs.authRejected -> getString(R.string.conn_rejected)
            !canMonitor -> getString(R.string.conn_no_permission)
            !canNumbers -> getString(R.string.conn_no_call_log)
            !DeviceInfo.isOnline(this) -> getString(R.string.conn_no_internet, queued)
            queued > 0 -> getString(R.string.conn_queued, queued)
            prefs.lastHeartbeatOk -> getString(R.string.conn_connected)
            else -> getString(R.string.conn_waiting, prefs.lastError ?: "")
        }
        val locOk = !guard || DeviceInfo.locationPermission(this) == "background"
        b.permissions.visibility = if (canMonitor && canNumbers && locOk) android.view.View.GONE else android.view.View.VISIBLE
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        b.battery.visibility = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) android.view.View.VISIBLE else android.view.View.GONE
    }

    private fun fmt(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}
