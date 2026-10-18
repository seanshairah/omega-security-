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
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import zw.co.omega.gateway.R
import zw.co.omega.gateway.call.CallMonitor
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.databinding.ActivityMainBinding
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.util.DeviceInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The dashboard. Shows three independent facts — shift, GPS, sync — plus device details, and
 * offers two independent actions: "Sync now" (outbox + heartbeat) and "Check location now" (GPS).
 * Which screen to show is decided once, by `resolveAppState`, never by two competing flags.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { render(); handler.postDelayed(this, 3000) } }
    private var onboardingOpened = false

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { render(); GatewayService.start(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        onboardingOpened = savedInstanceState?.getBoolean("onboardingOpened") ?: false
        when (appState()) {
            AppState.NOT_ACTIVATED -> { startActivity(Intent(this, ActivationActivity::class.java)); finish(); return }
            else -> {}
        }
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.settings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.permissions.setOnClickListener { openPermissions() }
        b.battery.setOnClickListener { requestIgnoreBatteryOptimisations() }
        b.syncNow.setOnClickListener {
            GatewayService.requestHeartbeat(this); GatewayService.requestSync(this)
            b.syncNow.isEnabled = false; handler.postDelayed({ b.syncNow.isEnabled = true; render() }, 2500)
        }
        b.checkNow.setOnClickListener {
            GatewayService.requestLocationCheck(this)
            b.checkNow.isEnabled = false; handler.postDelayed({ b.checkNow.isEnabled = true; render() }, 2500)
        }
        // Open onboarding once, only while permissions are still missing and it has never been finished.
        if (appState() == AppState.PERMISSIONS_INCOMPLETE && !onboardingOpened) { onboardingOpened = true; openPermissions() }
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); outState.putBoolean("onboardingOpened", onboardingOpened) }
    override fun onResume() { super.onResume(); GatewayService.start(this); handler.post(refresh) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(refresh) }

    private fun appState(): AppState = resolveAppState(AppFacts(prefs.isActivated, prefs.isGuardMode, prefs.authRejected, prefs.onboardingDone, DeviceInfo.locationPermission(this), DeviceInfo.callPermission(this)))

    /** Guard mode: the explanatory onboarding screen. Operations mode: the system dialog. */
    private fun openPermissions() {
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
        val state = appState()
        val isOnline = DeviceInfo.isOnline(this)
        val online = prefs.lastHeartbeatOk && !prefs.authRejected && isOnline
        val canMonitor = CallMonitor.canMonitor(this)
        val canNumbers = CallMonitor.canSeeNumbers(this)
        b.statusDot.text = when { prefs.authRejected -> "🔴"; online -> "🟢"; else -> "🔴" }
        b.statusWord.text = when { prefs.authRejected -> getString(R.string.status_rejected); online -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.deviceName.text = prefs.deviceName.ifBlank { "—" }
        b.location.text = prefs.locationName.ifBlank { getString(R.string.head_office) }
        b.phone.text = prefs.phoneNumber.ifBlank { "—" }
        b.lastHeartbeat.text = fmt(prefs.lastHeartbeatAt)
        val bat = DeviceInfo.batteryLevel(this)
        b.batteryLevel.text = if (bat >= 0) "$bat%" else "—"
        b.network.text = when (DeviceInfo.networkType(this)) { "mobile" -> getString(R.string.net_mobile); "wifi" -> getString(R.string.net_wifi); "none" -> getString(R.string.net_none); else -> getString(R.string.net_other) }
        b.appVersion.text = DeviceInfo.appVersion()
        b.lastCall.text = prefs.lastCallSummary?.let { "$it\n${fmt(prefs.lastCallAt)}" } ?: getString(R.string.no_calls_yet)

        // ---- Sync (independent of GPS) ----
        val queued = EventQueue(this).size()
        val facts = StatusFacts(shiftView(), prefs.gpsChecking, prefs.gpsState, prefs.gpsReason, prefs.lastCheckAt, isOnline, prefs.authRejected, queued, prefs.lastSyncAt, prefs.lastHeartbeatOk)
        b.syncLine.text = when (syncView(facts)) {
            SyncView.REVOKED -> getString(R.string.sync_revoked)
            SyncView.NO_INTERNET -> getString(R.string.sync_no_internet, queued)
            SyncView.QUEUED -> getString(R.string.sync_queued, queued)
            SyncView.SYNCED -> if (prefs.lastSyncAt > 0) getString(R.string.sync_synced, fmt(prefs.lastSyncAt)) else getString(R.string.sync_nothing_yet)
            SyncView.WAITING -> getString(R.string.sync_waiting, prefs.lastError ?: "")
        }

        // ---- Guard mode: shift, duty site, GPS ----
        val guard = prefs.isGuardMode
        b.guardRows.visibility = if (guard) View.VISIBLE else View.GONE
        b.checkNow.visibility = if (guard) View.VISIBLE else View.GONE
        b.modeLine.text = if (guard) getString(R.string.mode_guard, prefs.guardName.ifBlank { "—" }) else getString(R.string.mode_ops)
        if (guard) {
            val cfg = ShiftConfig.load(this)
            val now = System.currentTimeMillis()
            b.shiftLine.text = when {
                cfg == null -> getString(R.string.shift_none)
                cfg.isActiveAt(now) -> getString(R.string.shift_active, fmt(cfg.startAtMs), fmt(cfg.endAtMs))
                cfg.isUpcomingAt(now) -> getString(R.string.shift_upcoming, fmt(cfg.startAtMs))
                else -> getString(R.string.shift_none)
            }
            b.dutySiteLine.text = when {
                cfg == null -> "—"
                cfg.site == null -> getString(R.string.duty_site_no_coordinates)
                else -> getString(R.string.duty_site, cfg.site.name, cfg.site.radiusM)
            }
            b.gpsLine.text = when (gpsView(facts)) {
                GpsView.OFF -> getString(R.string.gps_off)
                GpsView.CHECKING -> getString(R.string.gps_checking)
                GpsView.INSIDE -> getString(R.string.gps_inside)
                GpsView.OUTSIDE_VERIFYING -> getString(R.string.gps_verifying)
                GpsView.OUTSIDE -> getString(R.string.gps_outside)
                GpsView.UNKNOWN -> getString(R.string.gps_unknown)
            }
            val limit = cfg?.policy?.accuracyMaxM ?: 100
            b.gpsReasonLine.text = when (gpsReasonKind(prefs.gpsReason, prefs.lastCheckAt)) {
                GpsReasonKind.NONE -> ""
                GpsReasonKind.NOT_CHECKED_YET -> getString(R.string.gps_reason_not_checked)
                GpsReasonKind.NO_FIX -> getString(R.string.gps_reason_no_fix)
                GpsReasonKind.POOR_ACCURACY -> getString(R.string.gps_reason_poor_accuracy, formatAccuracy(prefs.lastFixAccuracy), limit)
                GpsReasonKind.LOCATION_OFF -> getString(R.string.gps_reason_location_off)
                GpsReasonKind.PERMISSION -> getString(R.string.gps_reason_permission)
                GpsReasonKind.SITE_NO_COORDINATES -> getString(R.string.gps_reason_site)
                GpsReasonKind.ON_BOUNDARY -> getString(R.string.gps_reason_boundary, formatAccuracy(prefs.lastFixAccuracy))
            }
            b.gpsReasonLine.visibility = if (b.gpsReasonLine.text.isBlank()) View.GONE else View.VISIBLE
            b.lastCheckLine.text = when {
                prefs.lastFixAt > 0 -> getString(R.string.last_check, fmt(prefs.lastFixAt), prefs.lastFixState, formatDistance(prefs.lastFixDistanceM), formatAccuracy(prefs.lastFixAccuracy))
                prefs.lastAttemptAt > 0 -> getString(R.string.last_check_no_fix, fmt(prefs.lastAttemptAt))
                else -> getString(R.string.last_check_none)
            }
            b.locationPermLine.text = when (DeviceInfo.locationPermission(this)) { "background" -> getString(R.string.perm_bg); "foreground_only" -> getString(R.string.perm_fg); else -> getString(R.string.perm_denied) }
        }

        // ---- App state line and buttons ----
        b.connection.text = when (state) {
            AppState.REACTIVATION_REQUIRED -> getString(R.string.conn_rejected)
            AppState.PERMISSIONS_INCOMPLETE, AppState.PERMISSION_REVOKED -> when {
                guard && DeviceInfo.locationPermission(this) != "background" -> getString(R.string.conn_no_location_permission)
                !canMonitor -> getString(R.string.conn_no_permission)
                !canNumbers -> getString(R.string.conn_no_call_log)
                else -> getString(R.string.conn_no_permission)
            }
            AppState.READY -> when {
                !isOnline -> getString(R.string.conn_no_internet, queued)
                prefs.lastHeartbeatOk -> getString(R.string.conn_connected)
                else -> getString(R.string.conn_waiting, prefs.lastError ?: "")
            }
            AppState.NOT_ACTIVATED -> ""
        }
        b.permissions.visibility = if (state == AppState.READY || state == AppState.REACTIVATION_REQUIRED) View.GONE else View.VISIBLE
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        b.battery.visibility = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) View.VISIBLE else View.GONE
    }

    private fun shiftView(): ShiftView = when (prefs.shiftState) { "ACTIVE" -> ShiftView.ACTIVE; "UPCOMING" -> ShiftView.UPCOMING; else -> ShiftView.NONE }

    private fun fmt(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}
