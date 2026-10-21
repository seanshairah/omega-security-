package zw.co.omega.gateway.ui

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.CountDownTimer
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivityCallConfirmBinding
import zw.co.omega.gateway.model.DeviceCommand
import zw.co.omega.gateway.net.ApiClient
import zw.co.omega.gateway.service.CallRequestHandler

/**
 * "Operations asks you to call <guard>." One tap to dial, one to decline.
 *
 * With CALL_PHONE granted, Call places the call directly and the portal is told DIALING. Without
 * it, the system dialler opens with the number filled in; the portal is not told anything has
 * been dialled, because the app cannot see whether the operator presses Call there. The phone's
 * call record, which the gateway already reports, settles what actually happened either way.
 */
class CallConfirmActivity : AppCompatActivity() {
    private lateinit var b: ActivityCallConfirmBinding
    private var timer: CountDownTimer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityCallConfirmBinding.inflate(layoutInflater)
        setContentView(b.root)
        Insets.applySystemBars(b.root)
        render()
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); render() }
    override fun onDestroy() { timer?.cancel(); super.onDestroy() }

    private fun render() {
        val id = intent.getStringExtra(EXTRA_ID) ?: return finish()
        val number = intent.getStringExtra(EXTRA_NUMBER) ?: return finish()
        val guard = intent.getStringExtra(EXTRA_GUARD)
        val reason = intent.getStringExtra(EXTRA_REASON)
        val by = intent.getStringExtra(EXTRA_BY)
        val expires = intent.getLongExtra(EXTRA_EXPIRES, 0L)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(CallRequestHandler.notificationId(id))

        b.callWho.text = guard ?: number
        b.callNumber.text = number
        b.callReason.text = reason ?: getString(R.string.call_request_no_reason)
        b.callBy.text = if (by != null) getString(R.string.call_request_by, by) else getString(R.string.call_request_by_ops)
        val direct = canDialDirectly()
        b.callNow.text = getString(if (direct) R.string.call_now else R.string.call_open_dialler)
        b.callPermissionNote.visibility = if (direct) View.GONE else View.VISIBLE

        timer?.cancel()
        val left = expires - System.currentTimeMillis()
        if (left <= 0) { expired(); return }
        timer = object : CountDownTimer(left, 1000) {
            override fun onTick(ms: Long) { b.callExpires.text = getString(R.string.call_request_expires, (ms / 1000).toInt()) }
            override fun onFinish() { expired() }
        }.start()

        b.callNow.setOnClickListener {
            timer?.cancel()
            if (canDialDirectly()) {
                ack(id, "DIALING", null)
                startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$number")))
            } else {
                // The operator dials from the system app; only the call record will say whether they did.
                startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")))
            }
            finish()
        }
        b.callDecline.setOnClickListener { timer?.cancel(); ack(id, "CANCELLED", "Not now"); finish() }
    }

    private fun expired() {
        b.callExpires.text = getString(R.string.call_request_expired)
        b.callNow.isEnabled = false
    }

    private fun canDialDirectly() = ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    private fun ack(id: String, status: String, detail: String?) {
        val prefs = Prefs(this)
        lifecycleScope.launch(Dispatchers.IO) { runCatching { ApiClient(prefs.serverUrl, prefs.deviceToken).ackCommand(id, status, detail) } }
    }

    companion object {
        private const val EXTRA_ID = "id"; private const val EXTRA_NUMBER = "number"; private const val EXTRA_GUARD = "guard"
        private const val EXTRA_REASON = "reason"; private const val EXTRA_BY = "by"; private const val EXTRA_EXPIRES = "expires"

        fun intent(context: Context, c: DeviceCommand): Intent = Intent(context, CallConfirmActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ID, c.id).putExtra(EXTRA_NUMBER, c.phoneNumber).putExtra(EXTRA_GUARD, c.guardName)
            .putExtra(EXTRA_REASON, c.reason).putExtra(EXTRA_BY, c.requestedBy).putExtra(EXTRA_EXPIRES, c.expiresAtMs)
    }
}
