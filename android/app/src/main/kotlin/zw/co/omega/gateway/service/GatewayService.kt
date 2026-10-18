package zw.co.omega.gateway.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import zw.co.omega.gateway.GatewayApp
import zw.co.omega.gateway.R
import zw.co.omega.gateway.call.CallMonitor
import zw.co.omega.gateway.data.ConfigBus
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.location.LocationMonitor
import zw.co.omega.gateway.ui.MainActivity

/**
 * Long-running foreground service. Hosts two independent systems plus the heartbeat:
 *
 *  1. GPS monitoring — `MonitoringCoordinator` (guard mode only). One check at a time, woken by
 *     the schedule, by "Check location now" and by shift-config changes. Never cancelled by sync.
 *  2. Event sync — drains the outbox on demand (new events, network back, "Sync now", schedule)
 *     with exponential backoff. Independent of GPS.
 *  3. Heartbeat — device status + shift-config refresh on the configured interval.
 *
 * A persistent notification is required by Android for this.
 */
class GatewayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val syncRequests = Channel<Unit>(Channel.CONFLATED)
    private var heartbeatJob: Job? = null
    private var syncJob: Job? = null
    private val monitor by lazy { LocationMonitor(this) }
    private lateinit var coordinator: MonitoringCoordinator
    private lateinit var prefs: Prefs
    private lateinit var engine: SyncEngine
    private var phoneReceiver: BroadcastReceiver? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        engine = SyncEngine(this)
        coordinator = MonitoringCoordinator(
            scope = scope,
            stepper = {
                val r = monitor.step()
                MonitoringCoordinator.StepOutcome(nextCheckSeconds = if (r.hasConfig) r.nextCheckSeconds else 0, producedEvents = r.producedEvents)
            },
            isGuardMode = { prefs.isGuardMode },
            configChanges = ConfigBus.changes,
            onAfterStep = { r -> if (r?.producedEvents == true) syncRequests.trySend(Unit); updateNotification() },
            log = { Log.e(TAG, it) },
        )
        prefs.gpsChecking = false
        startInForeground(getString(R.string.notif_starting))
        registerPhoneReceiver()
        registerNetworkCallback()
        startLoops()
        SyncWorker.schedule(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!prefs.isActivated) { stopSelf(); return START_NOT_STICKY }
        when (intent?.action) {
            ACTION_SYNC -> syncRequests.trySend(Unit)
            ACTION_HEARTBEAT -> { heartbeatJob?.cancel(); heartbeatJob = heartbeatLoop() }
            ACTION_CHECK_LOCATION -> { if (prefs.isGuardMode) { coordinator.start(); val fresh = coordinator.requestCheck(); Log.i(TAG, if (fresh) "manual location check started" else "manual location check joined the running one") } }
            ACTION_CONFIG_CHANGED -> coordinator.onConfigChanged()
        }
        if (prefs.isGuardMode) coordinator.start()
        return START_STICKY
    }

    private fun startLoops() {
        heartbeatJob = heartbeatLoop()
        if (prefs.isGuardMode) coordinator.start()
        syncJob = scope.launch {
            var backoff = 5_000L
            while (true) {
                withTimeoutOrNull(backoff) { syncRequests.receive() }
                when (val r = engine.syncOnce()) {
                    is SyncEngine.Outcome.Done -> backoff = 60_000L
                    is SyncEngine.Outcome.Retry -> { backoff = (backoff * 3).coerceAtMost(15 * 60_000L); Log.w(TAG, "sync retry in ${backoff / 1000}s: ${r.error}") }
                    is SyncEngine.Outcome.Rejected -> { backoff = 60 * 60_000L; Log.e(TAG, "sync rejected: ${r.error}") }
                }
                updateNotification()
            }
        }
    }

    private fun heartbeatLoop(): Job = scope.launch {
        var failures = 0
        while (true) {
            val r = engine.heartbeat()
            failures = if (r is SyncEngine.Outcome.Done) 0 else failures + 1
            updateNotification()
            val base = prefs.heartbeatSeconds * 1000L
            val wait = if (r is SyncEngine.Outcome.Rejected) 30 * 60_000L else if (failures > 0) (base * (1 shl failures.coerceAtMost(4))).coerceAtMost(15 * 60_000L) else base
            delay(wait)
        }
    }

    private fun registerPhoneReceiver() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    TelephonyManager.ACTION_PHONE_STATE_CHANGED -> CallMonitor.onPhoneState(context, CallMonitor.extraState(intent), CallMonitor.extraNumber(intent))
                    @Suppress("DEPRECATION") Intent.ACTION_NEW_OUTGOING_CALL -> CallMonitor.onOutgoing(context, intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER))
                }
            }
        }
        val filter = IntentFilter().apply { addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED); @Suppress("DEPRECATION") addAction(Intent.ACTION_NEW_OUTGOING_CALL) }
        ContextCompat.registerReceiver(this, r, filter, ContextCompat.RECEIVER_EXPORTED)
        phoneReceiver = r
    }

    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { syncRequests.trySend(Unit); heartbeatJob?.cancel(); heartbeatJob = heartbeatLoop() }
        }
        try { cm.registerDefaultNetworkCallback(cb); networkCallback = cb } catch (e: Exception) { Log.w(TAG, "network callback: ${e.message}") }
    }

    private fun startInForeground(text: String) {
        val n = buildNotification(text)
        val type = if (prefs.isGuardMode && hasFineLocation()) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) startForeground(NOTIF_ID, n, type)
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST)
        else startForeground(NOTIF_ID, n)
    }

    private fun hasFineLocation() = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun buildNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, GatewayApp.CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_gateway)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    /** Notification: connectivity first, then (guard mode) the GPS fact, with its reason when unknown. */
    private fun updateNotification() {
        val base = when {
            prefs.authRejected -> getString(R.string.notif_rejected)
            !prefs.lastHeartbeatOk -> getString(R.string.notif_offline)
            else -> getString(R.string.notif_online, engine.queueSize())
        }
        val text = if (!prefs.isGuardMode) base else {
            val mon = when {
                prefs.shiftState == "NONE" -> getString(R.string.notif_mon_off)
                prefs.shiftState == "UPCOMING" -> getString(R.string.notif_mon_waiting)
                prefs.gpsChecking -> getString(R.string.notif_mon_checking)
                else -> when (prefs.gpsState) {
                    "MONITORING" -> getString(R.string.notif_mon_inside)
                    "OUTSIDE", "VERIFYING_OUTSIDE" -> getString(R.string.notif_mon_outside)
                    "LOCATION_UNAVAILABLE" -> when (prefs.gpsReason) { "poor_accuracy" -> getString(R.string.notif_mon_poor_accuracy); "location_disabled" -> getString(R.string.notif_mon_location_off); "permission_revoked" -> getString(R.string.notif_mon_permission); else -> getString(R.string.notif_mon_unavailable) }
                    else -> getString(R.string.notif_mon_off)
                }
            }
            "$base · $mon"
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    override fun onDestroy() {
        phoneReceiver?.let { runCatching { unregisterReceiver(it) } }
        networkCallback?.let { runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) } }
        coordinator.stop()
        heartbeatJob?.cancel(); syncJob?.cancel()
        scope.cancel()
        prefs.gpsChecking = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "GatewayService"
        const val NOTIF_ID = 1001
        const val ACTION_SYNC = "zw.co.omega.gateway.SYNC"
        const val ACTION_HEARTBEAT = "zw.co.omega.gateway.HEARTBEAT"
        const val ACTION_CHECK_LOCATION = "zw.co.omega.gateway.CHECK_LOCATION"
        const val ACTION_CONFIG_CHANGED = "zw.co.omega.gateway.CONFIG_CHANGED"

        fun start(context: Context) = send(context, null, "start")

        /** Sync the outbox now. Does not touch GPS monitoring. */
        fun requestSync(context: Context) = send(context, ACTION_SYNC, "sync request")

        fun requestHeartbeat(context: Context) = send(context, ACTION_HEARTBEAT, "heartbeat request")

        /** Run (or join) a location check now. Does not touch the sync engine. */
        fun requestLocationCheck(context: Context) = send(context, ACTION_CHECK_LOCATION, "location check request")

        private fun send(context: Context, action: String?, what: String) {
            if (!Prefs(context).isActivated) return
            val i = Intent(context, GatewayService::class.java).apply { action?.let { setAction(it) } }
            try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, i) else context.startService(i) }
            catch (e: Exception) { Log.w(TAG, "$what: ${e.message}") } // background-start restriction; WorkManager retries
        }

        fun stop(context: Context) = context.stopService(Intent(context, GatewayService::class.java))
    }
}
