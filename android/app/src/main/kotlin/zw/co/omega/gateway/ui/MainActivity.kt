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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import zw.co.omega.gateway.R
import zw.co.omega.gateway.alerts.AlertSender
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
 *  Guard mode:       connection · EMERGENCY + quick actions (sent from here through AlertFlow) ·
 *                    shift + duty site · GPS verification with a stat strip · sync · sent to
 *                    operations · device.
 *  Operations mode:  connection · call monitoring + recent call events · sync · device.
 *
 * Which screen to show is decided once, by `resolveAppState`, never by two competing flags.
 * Every button calls the existing handler (see docs/ANDROID_UI_AUDIT.md); nothing is duplicated.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable { override fun run() { render(); handler.postDelayed(this, 3000) } }
    private var onboardingOpened = false
    private val feedback = AlertFlow.Feedback { text, emergency ->
        b.feedback.text = text
        b.feedback.setBackgroundResource(if (emergency) R.drawable.bg_banner_red else R.drawable.bg_banner_green)
        b.feedback.visibility = View.VISIBLE
        render()
    }

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
        b.syncNow.setOnClickListener { lock(it) { GatewayService.requestHeartbeat(this); GatewayService.requestSync(this, Trigger.MANUAL) } }
        b.checkNow.setOnClickListener { lock(it) { GatewayService.requestLocationCheck(this) } }
        // Alerts are sent from here, through the same AlertFlow/AlertSender as the Alerts screen.
        b.emergency.setOnClickListener { lock(it) { AlertFlow.confirmEmergency(this, feedback) } }
        b.quickAssist.setOnClickListener { lock(it) { AlertFlow.askMessage(this, AlertSender.Type.NEED_ASSISTANCE, R.string.alert_assistance, R.string.alert_msg_hint_optional, false, feedback) } }
        b.quickOk.setOnClickListener { lock(it) { AlertFlow.send(this, AlertSender.Type.SHIFT_OK, null, feedback) } }
        b.quickMore.setOnClickListener { AlertsActivity.open(this, null) }
        b.commAll.setOnClickListener { AlertsActivity.open(this, null) }
        b.feedback.setOnClickListener { b.feedback.visibility = View.GONE }
        if (appState() == AppState.PERMISSIONS_INCOMPLETE && !onboardingOpened) { onboardingOpened = true; openPermissions() }
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); outState.putBoolean("onboardingOpened", onboardingOpened) }
    override fun onResume() { super.onResume(); GatewayService.start(this); handler.post(refresh) }
    override fun onPause() { super.onPause(); handler.removeCallbacks(refresh) }

    /** Buttons lock for 2.5 s after a tap so a nervous double-tap never sends twice. */
    private val locked = mutableSetOf<Int>()
    private fun lock(v: View, action: () -> Unit) { locked += v.id; v.isEnabled = false; handler.postDelayed({ locked -= v.id; v.isEnabled = true; render() }, 2500); action() }

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

        // ---- Header and connection card ----
        b.modeLine.text = getString(if (guard) R.string.guard_phone else R.string.ops_phone)
        b.statusDot.setBackgroundResource(when { prefs.authRejected -> R.drawable.circle_red; online -> R.drawable.circle_green; else -> R.drawable.circle_amber })
        b.statusWord.text = when { prefs.authRejected -> getString(R.string.status_rejected); online -> getString(R.string.status_online); else -> getString(R.string.status_offline) }
        b.identityLine.text = if (guard) getString(R.string.guard_phone_named, prefs.guardName.ifBlank { "—" }) else getString(R.string.mode_ops)
        val net = DeviceInfo.networkType(this)
        b.network.text = when (net) { "mobile" -> getString(R.string.net_mobile); "wifi" -> getString(R.string.net_wifi); "none" -> getString(R.string.net_none); else -> getString(R.string.net_other) }
        b.networkIcon.setImageResource(when (net) { "wifi" -> R.drawable.ic_wifi; "none" -> R.drawable.ic_offline; else -> R.drawable.ic_cellular })
        val canMonitor = CallMonitor.canMonitor(this)
        val canNumbers = CallMonitor.canSeeNumbers(this)
        val permissionProblem = state == AppState.PERMISSIONS_INCOMPLETE || state == AppState.PERMISSION_REVOKED
        val (netWord, netTone) = when {
            prefs.authRejected -> getString(R.string.net_revoked) to Tone.CRITICAL
            !isOnline -> getString(R.string.net_no_internet) to Tone.WARN
            permissionProblem -> getString(R.string.net_permission) to Tone.WARN
            prefs.lastHeartbeatOk -> getString(R.string.net_connected) to Tone.OK
            else -> getString(R.string.net_reconnecting) to Tone.WARN
        }
        b.networkState.text = netWord
        b.networkState.setTextColor(getColor(toneColour(netTone)))
        b.networkIcon.setColorFilter(getColor(toneColour(netTone)))
        // The detail banner appears only when something needs the guard's attention.
        val detail = when (state) {
            AppState.REACTIVATION_REQUIRED -> getString(R.string.conn_rejected)
            AppState.PERMISSIONS_INCOMPLETE, AppState.PERMISSION_REVOKED -> when {
                guard && DeviceInfo.locationPermission(this) != "background" -> getString(R.string.conn_no_location_permission)
                !canMonitor -> getString(R.string.conn_no_permission)
                !canNumbers -> getString(R.string.conn_no_call_log)
                else -> getString(R.string.conn_no_permission)
            }
            AppState.READY -> when {
                !isOnline -> resources.getQuantityString(R.plurals.conn_no_internet_events, queued, queued)
                prefs.lastHeartbeatOk -> ""
                else -> getString(R.string.conn_waiting, prefs.lastError ?: "")
            }
            AppState.NOT_ACTIVATED -> ""
        }
        b.connection.text = detail
        b.connection.visibility = if (detail.isBlank()) View.GONE else View.VISIBLE
        b.connection.setBackgroundResource(if (state == AppState.REACTIVATION_REQUIRED) R.drawable.bg_banner_red else R.drawable.bg_banner_amber)
        b.permissions.visibility = if (state == AppState.READY || state == AppState.REACTIVATION_REQUIRED) View.GONE else View.VISIBLE
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        b.battery.visibility = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) View.VISIBLE else View.GONE

        // ---- Sync card (both modes) ----
        val facts = StatusFacts(shiftView(), prefs.gpsChecking, prefs.gpsState, prefs.gpsReason, prefs.lastCheckAt, isOnline, prefs.authRejected, queued, prefs.lastSyncAt, prefs.lastHeartbeatOk, prefs.syncState)
        val sv = syncView(facts)
        b.syncLine.text = getString(when (sv) {
            SyncView.REVOKED -> R.string.sync_word_revoked; SyncView.NO_INTERNET -> R.string.sync_word_no_internet; SyncView.SENDING -> R.string.sync_word_sending
            SyncView.RETRY_PENDING -> R.string.sync_word_retry; SyncView.QUEUED -> R.string.sync_word_queued; SyncView.SYNCED_WITH_FAILURES -> R.string.sync_word_failures
            SyncView.SYNCED -> R.string.sync_word_synced; SyncView.WAITING -> R.string.sync_word_waiting
        })
        b.syncDetail.text = when (sv) {
            SyncView.REVOKED -> getString(R.string.sync_detail_revoked)
            SyncView.NO_INTERNET -> resources.getQuantityString(R.plurals.events_saved_on_phone, queued, queued)
            SyncView.SENDING -> resources.getQuantityString(R.plurals.events_sending, queued, queued)
            SyncView.RETRY_PENDING -> resources.getQuantityString(R.plurals.events_retrying, queued, queued, prefs.lastSyncError ?: "")
            SyncView.QUEUED -> resources.getQuantityString(R.plurals.events_queued, queued, queued)
            SyncView.SYNCED_WITH_FAILURES -> getString(R.string.sync_detail_failures)
            SyncView.SYNCED -> if (prefs.lastSyncAt > 0) getString(R.string.sync_detail_sent, fmt(prefs.lastSyncAt)) else getString(R.string.sync_detail_nothing)
            SyncView.WAITING -> getString(R.string.sync_detail_waiting, prefs.lastError ?: "")
        }
        // Two independent counts, so two plurals joined rather than one sentence with "(s)" twice.
        b.pendingLine.text = resources.getQuantityString(R.plurals.events_waiting_to_send, queued, queued) +
            " · " + resources.getQuantityString(R.plurals.events_rejected, counts.failed, counts.failed)
        b.lastSync.text = fmt(prefs.lastSyncAt)
        b.lastHeartbeat.text = fmt(prefs.lastHeartbeatAt)
        iconTone(b.syncIconWrap, b.syncIcon, syncTone(sv), when (sv) { SyncView.SYNCED -> R.drawable.ic_check; SyncView.SENDING -> R.drawable.ic_sync; SyncView.REVOKED -> R.drawable.ic_lock; else -> R.drawable.ic_clock })

        // ---- Device card (both modes) ----
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
        // ---- Shift and duty site ----
        when {
            cfg != null && cfg.isActiveAt(now) -> { b.shiftLine.text = getString(R.string.shift_active_short, fmt(cfg.startAtMs), fmt(cfg.endAtMs)); b.shiftSub.visibility = View.GONE }
            cfg != null && cfg.isUpcomingAt(now) -> { b.shiftLine.text = getString(R.string.shift_upcoming_short, fmt(cfg.startAtMs)); b.shiftSub.text = getString(R.string.shift_upcoming_sub); b.shiftSub.visibility = View.VISIBLE }
            else -> { b.shiftLine.text = getString(R.string.shift_none_short); b.shiftSub.text = getString(R.string.shift_none_sub); b.shiftSub.visibility = View.VISIBLE }
        }
        when {
            cfg == null -> { b.dutySiteName.text = getString(R.string.duty_site_none_title); b.dutySiteMeta.text = "—" }
            cfg.site == null -> { b.dutySiteName.text = cfg.site?.name ?: prefs.dutySiteName.ifBlank { getString(R.string.duty_site_none_title) }; b.dutySiteMeta.text = getString(R.string.duty_site_no_coordinates) }
            else -> {
                b.dutySiteName.text = cfg.site.name
                b.dutySiteMeta.text = getString(R.string.duty_site_meta, cfg.site.radiusM) + (if (cfg.geofenceSource == "SHIFT_OVERRIDE") getString(R.string.duty_site_override) else "") + (if (cfg.coordinatesSource == "TEST" && cfg.geofenceSource != "SHIFT_OVERRIDE") getString(R.string.duty_site_test) else "") + (cfg.configVersion?.let { getString(R.string.duty_site_meta_version, it) } ?: "")
            }
        }

        // ---- GPS verification ----
        val gv = gpsView(facts)
        b.gpsLine.text = getString(when (gv) { GpsView.OFF -> R.string.gps_title_off; GpsView.CHECKING -> R.string.gps_title_checking; GpsView.INSIDE -> R.string.gps_title_inside; GpsView.OUTSIDE_VERIFYING -> R.string.gps_title_verifying; GpsView.OUTSIDE -> R.string.gps_title_outside; GpsView.UNKNOWN -> R.string.gps_title_unknown })
        val limit = cfg?.policy?.accuracyMaxM ?: 100
        val reason = when (gpsReasonKind(prefs.gpsReason, prefs.lastCheckAt)) {
            GpsReasonKind.NONE -> ""
            GpsReasonKind.NOT_CHECKED_YET -> if (facts.shift == ShiftView.ACTIVE) getString(R.string.gps_reason_not_checked) else ""
            GpsReasonKind.NO_FIX -> getString(R.string.gps_reason_no_fix)
            GpsReasonKind.POOR_ACCURACY -> getString(R.string.gps_reason_poor_accuracy, formatAccuracy(prefs.lastFixAccuracy), limit)
            GpsReasonKind.LOCATION_OFF -> getString(R.string.gps_reason_location_off)
            GpsReasonKind.PERMISSION -> getString(R.string.gps_reason_permission)
            GpsReasonKind.SITE_NO_COORDINATES -> getString(R.string.gps_reason_site)
            GpsReasonKind.ON_BOUNDARY -> getString(R.string.gps_reason_boundary, formatAccuracy(prefs.lastFixAccuracy))
        }
        b.gpsReasonLine.text = when {
            gv == GpsView.UNKNOWN && reason.isNotBlank() -> reason
            gv == GpsView.OFF -> getString(R.string.gps_sub_off)
            gv == GpsView.CHECKING -> getString(R.string.gps_sub_checking)
            gv == GpsView.INSIDE -> getString(R.string.gps_sub_inside)
            gv == GpsView.OUTSIDE_VERIFYING -> getString(R.string.gps_sub_verifying)
            gv == GpsView.OUTSIDE -> getString(R.string.gps_sub_outside)
            else -> reason
        }
        b.gpsReasonLine.visibility = if (b.gpsReasonLine.text.isBlank()) View.GONE else View.VISIBLE
        iconTone(b.gpsIconWrap, b.gpsIcon, gpsTone(gv), when (gv) { GpsView.INSIDE -> R.drawable.ic_check; GpsView.OUTSIDE -> R.drawable.ic_warning; GpsView.CHECKING -> R.drawable.ic_my_location; GpsView.OFF -> R.drawable.ic_pause; else -> R.drawable.ic_exclaim }, filled = true)
        // Stat strip: last check · accuracy vs limit · status + permission
        val hasFix = prefs.lastFixAt > 0
        b.lastCheckTime.text = when { hasFix -> fmt(prefs.lastFixAt); prefs.lastAttemptAt > 0 -> fmt(prefs.lastAttemptAt); else -> "—" }
        b.lastCheckMeta.text = when { hasFix -> getString(R.string.stat_from_site, formatDistance(prefs.lastFixDistanceM), formatAccuracy(prefs.lastFixAccuracy)); prefs.lastAttemptAt > 0 -> getString(R.string.last_check_no_fix, "").trim(' ', '·'); else -> getString(R.string.last_check_none) }
        b.accuracyValue.text = if (hasFix) formatAccuracy(prefs.lastFixAccuracy) else "—"
        b.accuracyMeta.text = getString(R.string.stat_limit, limit)
        b.statusValue.text = gpsStatusWord(gv)
        b.statusValue.setTextColor(getColor(when (gv) { GpsView.INSIDE -> R.color.accent_strong; GpsView.OUTSIDE -> R.color.critical; else -> R.color.ink }))
        b.statusMeta.text = when (DeviceInfo.locationPermission(this)) { "background" -> getString(R.string.stat_perm_bg); "foreground_only" -> getString(R.string.stat_perm_fg); else -> getString(R.string.stat_perm_denied) }
        val every = cfg?.policy?.checkMinutes ?: 10
        b.monitoringLine.text = when {
            facts.shift != ShiftView.ACTIVE -> getString(R.string.mon_off_line)
            DeviceInfo.locationPermission(this) != "background" -> getString(R.string.mon_fg_only_line)
            prefs.gpsState == "OUTSIDE" || prefs.gpsState == "VERIFYING_OUTSIDE" -> getString(R.string.mon_outside_line, cfg?.policy?.outsideCheckMinutes ?: 3)
            prefs.batterySaver -> getString(R.string.mon_saver_line, every * 2)
            else -> getString(R.string.mon_on_line, every)
        }
        b.checkNow.isEnabled = !prefs.gpsChecking && b.checkNow.id !in locked
        b.checkNow.text = getString(if (prefs.gpsChecking) R.string.gps_title_checking else R.string.check_location_now)

        // ---- Quick-action badge and "sent to operations" ----
        val unacked = queue.unacknowledgedAlerts()
        b.unackedLine.visibility = if (unacked > 0) View.VISIBLE else View.GONE
        b.unackedLine.text = resources.getQuantityString(R.plurals.alerts_waiting, unacked, unacked)
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.commList.removeAllViews()
        val rows = queue.recentComm(4)
        if (rows.isEmpty()) b.commList.addView(commRow(R.drawable.ic_doc, R.drawable.circle_grey_soft, R.color.ink2, getString(R.string.comm_none_title), getString(R.string.comm_none_body), R.color.ink3))
        for (r in rows) {
            val label = if (r.kind == "ALERT" || r.kind == "operations") AlertsActivity.labelFor(r.type) else r.summary ?: r.type
            val emergency = r.type == "EMERGENCY"
            b.commList.addView(commRow(
                when { emergency -> R.drawable.ic_warning; r.kind == "CALL" -> R.drawable.ic_phone; r.kind == "operations" -> R.drawable.ic_my_location; else -> R.drawable.ic_doc },
                when { emergency -> R.drawable.circle_red_soft; r.status == "ACKNOWLEDGED" || r.status == "RESOLVED" -> R.drawable.circle_green_soft; else -> R.drawable.circle_grey_soft },
                when { emergency -> R.color.critical; r.status == "ACKNOWLEDGED" || r.status == "RESOLVED" -> R.color.accent; else -> R.color.ink2 },
                "${f.format(Date(r.at))} · $label${if (r.kind == "ALERT" && r.summary != null) " · ${r.summary}" else ""}", AlertsActivity.commStateText(this, r), AlertsActivity.commStateColour(r)))
        }
    }

    private fun renderOps(queue: EventQueue, canMonitor: Boolean, canNumbers: Boolean) {
        b.callMonitorTitle.text = getString(when { !canMonitor -> R.string.call_mon_title_off; !canNumbers -> R.string.call_mon_title_partial; else -> R.string.call_mon_title_active })
        b.callMonitorLine.text = when { !canMonitor -> getString(R.string.call_mon_no_permission); !canNumbers -> getString(R.string.call_mon_no_numbers); else -> getString(R.string.call_mon_active) }
        b.callIconWrap.setBackgroundResource(when { !canMonitor -> R.drawable.circle_red; !canNumbers -> R.drawable.circle_amber; else -> R.drawable.circle_green })
        b.lastCall.text = prefs.lastCallSummary?.let { "$it · ${fmt(prefs.lastCallAt)}" } ?: getString(R.string.no_calls_yet)
        val f = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.opsCalls.removeAllViews()
        val rows = queue.recentComm(6, kind = "CALL")
        if (rows.isEmpty()) b.opsCalls.addView(line(getString(R.string.no_calls_yet), R.color.ink3, 14f))
        for (r in rows) {
            b.opsCalls.addView(line("${f.format(Date(r.at))} · ${r.summary ?: r.type}", R.color.ink, 14.5f))
            b.opsCalls.addView(line(when (r.status) { "QUEUED" -> getString(R.string.delivery_queued); "FAILED" -> getString(R.string.delivery_failed); else -> getString(R.string.delivery_sent, f.format(Date(r.sentAt ?: r.at))) }, if (r.status == "QUEUED") R.color.warn_strong else if (r.status == "FAILED") R.color.critical else R.color.ink2, 12.5f))
        }
    }

    /** One row of the "sent to operations" list: tinted icon circle, title, delivery state. */
    private fun commRow(icon: Int, circle: Int, iconColour: Int, title: String, state: String, stateColour: Int): View {
        val d = resources.displayMetrics.density
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; setPadding(0, (10 * d).toInt(), 0, (4 * d).toInt()) }
        val wrap = android.widget.FrameLayout(this).apply { setBackgroundResource(circle); layoutParams = LinearLayout.LayoutParams((40 * d).toInt(), (40 * d).toInt()) }
        wrap.addView(ImageView(this).apply { setImageResource(icon); setColorFilter(getColor(iconColour)); layoutParams = android.widget.FrameLayout.LayoutParams((20 * d).toInt(), (20 * d).toInt(), android.view.Gravity.CENTER) })
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (12 * d).toInt() } }
        col.addView(TextView(this).apply { text = title; setTextColor(getColor(R.color.ink)); textSize = 14.5f; setTypeface(typeface, android.graphics.Typeface.BOLD) })
        col.addView(TextView(this).apply { text = state; setTextColor(getColor(stateColour)); textSize = 12.5f })
        row.addView(wrap); row.addView(col)
        return row
    }

    /** Paint a card's icon circle for a tone: filled colour with white glyph, or soft tint with coloured glyph. */
    private fun iconTone(wrap: View, icon: ImageView, tone: Tone, drawable: Int, filled: Boolean = false) {
        icon.setImageResource(drawable)
        if (filled) {
            wrap.setBackgroundResource(when (tone) { Tone.OK -> R.drawable.circle_green; Tone.WARN -> R.drawable.circle_amber; Tone.CRITICAL -> R.drawable.circle_red; Tone.INFO -> R.drawable.circle_green; Tone.NEUTRAL -> R.drawable.circle_grey })
            icon.setColorFilter(getColor(R.color.surface))
        } else {
            wrap.setBackgroundResource(when (tone) { Tone.OK, Tone.INFO -> R.drawable.circle_green_soft; Tone.WARN -> R.drawable.circle_amber_soft; Tone.CRITICAL -> R.drawable.circle_red_soft; Tone.NEUTRAL -> R.drawable.circle_grey_soft })
            icon.setColorFilter(getColor(toneColour(tone)))
        }
    }

    private fun toneColour(t: Tone): Int = when (t) { Tone.OK, Tone.INFO -> R.color.accent_strong; Tone.WARN -> R.color.warn_strong; Tone.CRITICAL -> R.color.critical; Tone.NEUTRAL -> R.color.ink2 }

    private fun line(text: String, colour: Int, size: Float): TextView = TextView(this).apply { this.text = text; setTextColor(getColor(colour)); textSize = size; setPadding(0, 6, 0, 0) }

    private fun shiftView(): ShiftView = when (prefs.shiftState) { "ACTIVE" -> ShiftView.ACTIVE; "UPCOMING" -> ShiftView.UPCOMING; else -> ShiftView.NONE }

    private fun fmt(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
}
