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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import zw.co.omega.gateway.GatewayApp
import zw.co.omega.gateway.R
import zw.co.omega.gateway.call.CallMonitor
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.ui.MainActivity

/**
 * Long-running foreground service: keeps the process alive (as far as the manufacturer allows),
 * listens for phone-state broadcasts, sends heartbeats on the configured interval and drains the
 * outbox with exponential backoff. A persistent notification is required by Android for this.
 */
class GatewayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val syncRequests = Channel<Unit>(Channel.CONFLATED)
    private var heartbeatJob: Job? = null
    private var syncJob: Job? = null
    private lateinit var prefs: Prefs
    private lateinit var engine: SyncEngine
    private var phoneReceiver: BroadcastReceiver? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        engine = SyncEngine(this)
        startInForeground(getString(R.string.notif_starting))
        registerPhoneReceiver()
        registerNetworkCallback()
        startLoops()
        SyncWorker.schedule(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!prefs.isActivated) { stopSelf(); return START_NOT_STICKY }
        if (intent?.action == ACTION_SYNC) syncRequests.trySend(Unit)
        if (intent?.action == ACTION_HEARTBEAT) { heartbeatJob?.cancel(); heartbeatJob = heartbeatLoop() }
        return START_STICKY
    }

    private fun startLoops() {
        heartbeatJob = heartbeatLoop()
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST)
        else startForeground(NOTIF_ID, n)
    }

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

    private fun updateNotification() {
        val text = when {
            prefs.authRejected -> getString(R.string.notif_rejected)
            !prefs.lastHeartbeatOk -> getString(R.string.notif_offline)
            else -> getString(R.string.notif_online, engine.queueSize())
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    override fun onDestroy() {
        phoneReceiver?.let { runCatching { unregisterReceiver(it) } }
        networkCallback?.let { runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) } }
        scope.launch { }.cancel()
        heartbeatJob?.cancel(); syncJob?.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "GatewayService"
        const val NOTIF_ID = 1001
        const val ACTION_SYNC = "zw.co.omega.gateway.SYNC"
        const val ACTION_HEARTBEAT = "zw.co.omega.gateway.HEARTBEAT"

        fun start(context: Context) {
            if (!Prefs(context).isActivated) return
            val i = Intent(context, GatewayService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, i) else context.startService(i)
            } catch (e: Exception) {
                Log.w(TAG, "could not start service: ${e.message}") // background-start restriction; WorkManager retries
            }
        }

        fun requestSync(context: Context) {
            if (!Prefs(context).isActivated) return
            val i = Intent(context, GatewayService::class.java).setAction(ACTION_SYNC)
            try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, i) else context.startService(i) } catch (e: Exception) { Log.w(TAG, "sync request: ${e.message}") }
        }

        fun requestHeartbeat(context: Context) {
            val i = Intent(context, GatewayService::class.java).setAction(ACTION_HEARTBEAT)
            try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(context, i) else context.startService(i) } catch (e: Exception) { Log.w(TAG, "heartbeat request: ${e.message}") }
        }

        fun stop(context: Context) = context.stopService(Intent(context, GatewayService::class.java))
    }
}
