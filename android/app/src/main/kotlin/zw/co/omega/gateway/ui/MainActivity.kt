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
import zw.co.omega.gateway.alerts.AlertSender
import zw.co.omega.gateway.call.CallMonitor
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.data.ShiftConfig
import zw.co.omega.gateway.databinding.ActivityMainBinding
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.service.Trigger
import zw.co.omega.gateway.util.DeviceInfo

/**
 * The home screen (layout and order in activity_main.xml; drawing in HomeScreen):
 *
 *  Guard mode:       header · attention · shift (primary) · EMERGENCY + quick actions (sent from
 *                    here through AlertFlow) · location · sent to operations · sync footer.
 *  Operations mode:  header · attention · call monitoring + recent call events · sync footer.
 *  Device details and the sync history are in Diagnostics (SettingsActivity).
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
        // Edge to edge: the screen takes the status bar, the sync footer the navigation bar.
        Insets.applySystemBars(b.screen, top = true, bottom = false)
        Insets.applySystemBars(b.syncBar, top = false, bottom = true)
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
        // CALL_PHONE: so a call the portal asks for dials with one tap instead of opening the dialler.
        val wanted = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG, Manifest.permission.CALL_PHONE)
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
        HomeScreen.bind(this, b, facts())
        b.checkNow.isEnabled = !prefs.gpsChecking && b.checkNow.id !in locked
    }

    /** The phone's state, read once per refresh and handed to HomeScreen, which only draws. */
    private fun facts(): HomeFacts {
        val queue = EventQueue(this)
        val counts = queue.counts()
        val cfg = ShiftConfig.load(this)
        val now = System.currentTimeMillis()
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        val guard = prefs.isGuardMode
        return HomeFacts(
            guardMode = guard, appState = appState(), guardName = prefs.guardName, deviceName = prefs.deviceName,
            network = DeviceInfo.networkType(this), isOnline = DeviceInfo.isOnline(this), heartbeatOk = prefs.lastHeartbeatOk,
            authRejected = prefs.authRejected, lastError = prefs.lastError, locationPermission = DeviceInfo.locationPermission(this),
            canMonitorCalls = CallMonitor.canMonitor(this), canSeeNumbers = CallMonitor.canSeeNumbers(this),
            batteryRestricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName),
            queued = counts.pending, rejected = counts.failed, lastSyncAt = prefs.lastSyncAt, lastHeartbeatAt = prefs.lastHeartbeatAt,
            syncState = prefs.syncState, lastSyncError = prefs.lastSyncError,
            shift = cfg?.let { c ->
                HomeShift(c.startAtMs, c.endAtMs, c.isActiveAt(now), c.isUpcomingAt(now), c.site?.name ?: prefs.dutySiteName.ifBlank { null }, c.site != null,
                    c.site?.radiusM ?: 0, c.geofenceSource == "SHIFT_OVERRIDE", c.coordinatesSource == "TEST", c.configVersion,
                    c.policy.checkMinutes, c.policy.outsideCheckMinutes, c.policy.accuracyMaxM)
            },
            gpsChecking = prefs.gpsChecking, gpsState = prefs.gpsState, gpsReason = prefs.gpsReason, lastCheckAt = prefs.lastCheckAt,
            lastFixAt = prefs.lastFixAt, lastAttemptAt = prefs.lastAttemptAt, lastFixAccuracy = prefs.lastFixAccuracy, lastFixDistanceM = prefs.lastFixDistanceM,
            batterySaver = prefs.batterySaver,
            unacknowledged = if (guard) queue.unacknowledgedAlerts() else 0,
            recent = if (guard) queue.recentComm(3) else emptyList(),
            lastCallSummary = prefs.lastCallSummary, lastCallAt = prefs.lastCallAt,
            calls = if (guard) emptyList() else queue.recentComm(6, kind = "CALL"),
            now = now,
        )
    }

}
