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
import android.widget.TextView
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
import zw.co.omega.gateway.service.Trigger
import zw.co.omega.gateway.util.DeviceInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The dashboard, one card per fact so nothing is mixed up:
 *
 *  Guard mode:       connection · quick actions (EMERGENCY, assistance, going well, more) · shift + duty site ·
 *                    GPS verification + monitoring + last check · delivery (sync, pending, last sync/heartbeat) ·
 *                    communication history · device health.
 *  Operations mode:  connection · call monitoring + recent call events · delivery · device health.
 *
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
        if (appState() == AppState.NOT_ACTIVATED) { startActivity(Intent(this, ActivationActivity::class.java)); finish(); return }
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.settings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.permissions.setOnClickListener { openPermissions() }
        b.battery.setOnClickListener { requestIgnoreBatteryOptimisations() }
        b.syncNow.setOnClickListener {
            GatewayService.requestHeartbeat(this); GatewayService.requestSync(this, Trigger.MANUAL)
            b.syncNow.isEnabled = false; handler.postDelayed({ b.syncNow.isEnabled = true; render() }, 2500)
        }
        b.checkNow.setOnClickListener {
            GatewayService.requestLocationCheck(this)
            b.checkNow.isEnabled = false; handler.postDelayed({ b.checkNow.isEnabled = true; render() }, 2500)
        }
        b.emergency.setOnClickListener { AlertsActivity.open(this, AlertsActivity.ACTION_EMERGENCY) }
        b.quickAssist.setOnClickListener { AlertsActivity.open(this, AlertsActivity.ACTION_ASSISTANCE) }
        b.quickOk.setOnClickListener { AlertsActivity.open(this, AlertsActivity.ACTION_OK) }
        b.quickMore.setOnClickListener { AlertsActivity.open(this, null) }
        b.commAll.setOnClickListener { AlertsActivity.open(this, null) }
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
        val guard = prefs.isGuardMode
        val isOnline = DeviceInfo.isOnline(this)
        val online = prefs.lastHeartbeatOk && !prefs.authRejected && isOnline
        val queue = EventQueue(this)
        val counts = queue.counts()
        val queued = counts.pending

        // ---- Connection card ----
        b.statusDot.text = when { prefs.authRejected -> "🔴"; online -> "🟢"; else -> "🔴" }
        b.statusWord.text = when { prefs.authRejected -> getString(R.string.status_rejected); online -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.network.text = when (DeviceInfo.networkType(this)) { "mobile" -> getString(R.string.net_mobile); "wifi" -> getString(R.string.net_wifi); "none" -> getString(R.string.net_none); else -> getString(R.string.net_other) }
        b.modeLine.text = if (guard) getString(R.string.mode_guard, prefs.guardName.ifBlank { "—" }) else getString(R.string.mode_ops)
        val canMonitor = CallMonitor.canMonitor(this)
        val canNumbers = CallMonitor.canSeeNumbers(this)
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

        // ---- Delivery card (both modes) ----
        val facts = StatusFacts(shiftView(), prefs.gpsChecking, prefs.gpsState, prefs.gpsReason, prefs.lastCheckAt, isOnline, prefs.authRejected, queued, prefs.lastSyncAt, prefs.lastHeartbeatOk, prefs.syncState)
        b.syncLine.text = when (syncView(facts)) {
            SyncView.REVOKED -> getString(R.string.sync_revoked)
            SyncView.NO_INTERNET -> getString(R.string.sync_no_internet, queued)
            SyncView.SENDING -> getString(R.string.sync_sending, queued)
            SyncView.RETRY_PENDING -> getString(R.string.sync_retry, queued, prefs.lastSyncError ?: "")
            SyncView.QUEUED -> getString(R.string.sync_queued, queued)
            SyncView.SYNCED_WITH_FAILURES -> getString(R.string.sync_failures)
            SyncView.SYNCED -> if (prefs.lastSyncAt > 0) getString(R.string.sync_synced, fmt(prefs.lastSyncAt)) else getString(R.string.sync_nothing_yet)
            SyncView.WAITING -> getString(R.string.sync_waiting, prefs.lastError ?: "")
        }
        b.pendingLine.text = getString(R.string.pending_line, queued, counts.failed)
        b.lastSync.text = fmt(prefs.lastSyncAt)
        b.lastHeartbeat.text = fmt(prefs.lastHeartbeatAt)

        // ---- Device health (both modes) ----
        val bat = DeviceInfo.batteryLevel(this)
        b.deviceName.text = prefs.deviceName.ifBlank { "—" }
        b.deviceLine.text = getString(R.string.device_line, prefs.phoneNumber.ifBlank { "—" }, prefs.locationName.ifBlank { getString(R.string.head_office) }, DeviceInfo.appVersion())
        b.healthLine.text = getString(R.string.health_line, if (bat >= 0) "$bat%" else "—", if (prefs.batterySaver) getString(R.string.health_saver) else "", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pm.isIgnoringBatteryOptimizations(packageName)) getString(R.string.health_bg_ok) else getString(R.string.health_bg_restricted), DeviceInfo.model())

        b.guardRows.visibility = if (guard) View.VISIBLE else View.GONE
        b.commCard.visibility = if (guard) View.VISIBLE else View.GONE
        b.opsRows.visibility = if (guard) View.GONE else View.VISIBLE
        if (guard) renderGuard(queue, facts) else renderOps(queue, canMonitor, canNumbers)
    }

    private fun renderGuard(queue: EventQueue, facts: StatusFacts) {
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
            else -> getString(R.string.duty_site, cfg.site.name, cfg.site.radiusM) + (if (cfg.geofenceSource == "SHIFT_OVERRIDE") getString(R.string.duty_site_override) else "") + (if (cfg.coordinatesSource == "TEST" && cfg.geofenceSource != "SHIFT_OVERRIDE") getString(R.string.duty_site_test) else "") + (cfg.configVersion?.let { getString(R.string.duty_site_version, it) } ?: "")
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
            GpsReasonKind.NOT_CHECKED_YET -> if (facts.shift == ShiftView.ACTIVE) getString(R.string.gps_reason_not_checked) else ""
            GpsReasonKind.NO_FIX -> getString(R.string.gps_reason_no_fix)
            GpsReasonKind.POOR_ACCURACY -> getString(R.string.gps_reason_poor_accuracy, formatAccuracy(prefs.lastFixAccuracy), limit)
            GpsReasonKind.LOCATION_OFF -> getString(R.string.gps_reason_location_off)
            GpsReasonKind.PERMISSION -> getString(R.string.gps_reason_permission)
            GpsReasonKind.SITE_NO_COORDINATES -> getString(R.string.gps_reason_site)
            GpsReasonKind.ON_BOUNDARY -> getString(R.string.gps_reason_boundary, formatAccuracy(prefs.lastFixAccuracy))
        }
        b.gpsReasonLine.visibility = if (b.gpsReasonLine.text.isBlank()) View.GONE else View.VISIBLE
        val every = cfg?.policy?.checkMinutes ?: 10
        b.monitoringLine.text = when {
            facts.shift != ShiftView.ACTIVE -> getString(R.string.mon_off_line)
            DeviceInfo.locationPermission(this) != "background" -> getString(R.string.mon_fg_only_line)
            prefs.gpsState == "OUTSIDE" || prefs.gpsState == "VERIFYING_OUTSIDE" -> getString(R.string.mon_outside_line, cfg?.policy?.outsideCheckMinutes ?: 3)
            prefs.batterySaver -> getString(R.string.mon_saver_line, every * 2)
            else -> getString(R.string.mon_on_line, every)
        }
        b.lastCheckLine.text = when {
            prefs.lastFixAt > 0 -> getString(R.string.last_check, fmt(prefs.lastFixAt), prefs.lastFixState, formatDistance(prefs.lastFixDistanceM), formatAccuracy(prefs.lastFixAccuracy))
            prefs.lastAttemptAt > 0 -> getString(R.string.last_check_no_fix, fmt(prefs.lastAttemptAt))
            else -> getString(R.string.last_check_none)
        }
        b.locationPermLine.text = when (DeviceInfo.locationPermission(this)) { "background" -> getString(R.string.perm_bg); "foreground_only" -> getString(R.string.perm_fg); else -> getString(R.string.perm_denied) }
        val unacked = queue.unacknowledgedAlerts()
        b.unackedLine.visibility = if (unacked > 0) View.VISIBLE else View.GONE
        b.unackedLine.text = getString(R.string.unacked_alerts, unacked)
        // Communication history: the last few things sent, with their state.
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.commList.removeAllViews()
        val rows = queue.recentComm(4)
        if (rows.isEmpty()) b.commList.addView(line(getString(R.string.comm_none), R.color.ink3, 13f))
        for (r in rows) {
            val label = if (r.kind == "ALERT") AlertsActivity.labelFor(r.type) else r.summary ?: r.type
            b.commList.addView(line("${f.format(Date(r.at))} · $label${if (r.kind == "ALERT" && r.summary != null) " · ${r.summary}" else ""}", R.color.ink, 13.5f))
            b.commList.addView(line(commState(r), when (r.status) { "QUEUED" -> R.color.warn; "FAILED" -> R.color.critical; "ACKNOWLEDGED", "RESOLVED" -> R.color.accent_strong; else -> R.color.ink2 }, 12f))
        }
    }

    private fun renderOps(queue: EventQueue, canMonitor: Boolean, canNumbers: Boolean) {
        b.callMonitorLine.text = when {
            !canMonitor -> getString(R.string.call_mon_no_permission)
            !canNumbers -> getString(R.string.call_mon_no_numbers)
            else -> getString(R.string.call_mon_active)
        }
        b.lastCall.text = prefs.lastCallSummary?.let { "$it · ${fmt(prefs.lastCallAt)}" } ?: getString(R.string.no_calls_yet)
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.opsCalls.removeAllViews()
        val rows = queue.recentComm(6, kind = "CALL")
        if (rows.isEmpty()) b.opsCalls.addView(line(getString(R.string.no_calls_yet), R.color.ink3, 13f))
        for (r in rows) {
            b.opsCalls.addView(line("${f.format(Date(r.at))} · ${r.summary ?: r.type}", R.color.ink, 13.5f))
            b.opsCalls.addView(line(when (r.status) { "QUEUED" -> getString(R.string.delivery_queued); "FAILED" -> getString(R.string.delivery_failed); else -> getString(R.string.delivery_sent, f.format(Date(r.sentAt ?: r.at))) }, if (r.status == "QUEUED") R.color.warn else if (r.status == "FAILED") R.color.critical else R.color.ink2, 12f))
        }
    }

    private fun commState(r: EventQueue.CommRow): String {
        val f = SimpleDateFormat("HH:mm", Locale.getDefault())
        return when (r.status) {
            "QUEUED" -> getString(R.string.alert_state_queued)
            "SENT" -> if (r.kind == "ALERT") getString(R.string.alert_state_sent, f.format(Date(r.sentAt ?: r.at))) else getString(R.string.delivery_sent, f.format(Date(r.sentAt ?: r.at)))
            "ACKNOWLEDGED" -> getString(R.string.alert_state_acked, r.ackBy ?: "operations", r.ackAt?.let { f.format(Date(it)) } ?: "", r.ackNote?.let { " · “$it”" } ?: "")
            "RESOLVED" -> getString(R.string.alert_state_resolved, r.ackBy ?: "operations", r.ackNote?.let { " · “$it”" } ?: "")
            else -> getString(R.string.alert_state_failed, r.ackNote ?: "")
        }
    }

    private fun line(text: String, colour: Int, size: Float): TextView = TextView(this).apply { this.text = text; setTextColor(getColor(colour)); textSize = size; setPadding(0, 6, 0, 0) }

    private fun shiftView(): ShiftView = when (prefs.shiftState) { "ACTIVE" -> ShiftView.ACTIVE; "UPCOMING" -> ShiftView.UPCOMING; else -> ShiftView.NONE }

    private fun fmt(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}
