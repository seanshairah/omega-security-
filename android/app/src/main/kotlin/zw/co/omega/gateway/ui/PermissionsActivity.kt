package zw.co.omega.gateway.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.View
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.Prefs
import zw.co.omega.gateway.databinding.ActivityPermissionsBinding
import zw.co.omega.gateway.service.GatewayService
import zw.co.omega.gateway.util.DeviceInfo

/**
 * Guard-mode onboarding. Explains in plain words what the app does and asks for each permission
 * in the order Android requires: location while using the app → "Allow all the time" (Android 10+
 * must be granted from Settings) → phone and call log → notifications → battery optimisation.
 * Nothing is tracked until these are granted, and the guard can read why on this screen.
 */
class PermissionsActivity : AppCompatActivity() {
    private lateinit var b: ActivityPermissionsBinding
    private lateinit var prefs: Prefs
    private val launcher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        b = ActivityPermissionsBinding.inflate(layoutInflater)
        setContentView(b.root)
        Insets.applySystemBars(b.root)
        b.location.setOnClickListener { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
        b.background.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) launcher.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        }
        b.phone.setOnClickListener { launcher.launch(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)) }
        b.notifications.setOnClickListener { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) }
        b.battery.setOnClickListener { try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } }
        // Start: remember that onboarding was completed, bring the service up and return to the
        // dashboard. MainActivity is normally already underneath (it opened us), so finishing is
        // enough; when we were opened straight from activation there is nothing underneath, so
        // open the dashboard explicitly. MainActivity never re-opens onboarding on its own after this.
        b.done.setOnClickListener {
            prefs.onboardingDone = true
            GatewayService.start(this)
            if (isTaskRoot) startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
    }

    override fun onResume() { super.onResume(); render() }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun render() {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val phone = granted(Manifest.permission.READ_PHONE_STATE) && granted(Manifest.permission.READ_CALL_LOG)
        val notif = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(Manifest.permission.POST_NOTIFICATIONS)
        val batt = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        // Was `v.text = if (ok) "✅" else "⬜"`. Emoji render differently on every device font, can
        // come out as tofu, and a screen reader reads "white large square" rather than the state.
        fun mark(v: android.widget.ImageView, ok: Boolean) {
            v.setImageResource(if (ok) R.drawable.ic_perm_granted else R.drawable.ic_perm_pending)
            v.setColorFilter(androidx.core.content.ContextCompat.getColor(this, if (ok) R.color.ok else R.color.ink3))
            v.contentDescription = getString(if (ok) R.string.perm_state_granted else R.string.perm_state_pending)
        }
        // A granted permission has nothing left to ask for, so its button goes: the guard watches
        // the screen empty out instead of reading five identical green buttons for the one that is
        // still their turn. It comes back on the next onResume if the permission is withdrawn.
        fun step(dot: android.widget.ImageView, action: android.widget.Button, ok: Boolean) {
            mark(dot, ok)
            action.visibility = if (ok) View.GONE else View.VISIBLE
        }
        step(b.locationMark, b.location, fine)
        step(b.backgroundMark, b.background, bg)
        step(b.phoneMark, b.phone, phone)
        step(b.notificationsMark, b.notifications, notif)
        step(b.batteryMark, b.battery, batt)
        b.background.isEnabled = fine
        b.backgroundHint.text = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) getString(R.string.perm_background_hint_r) else getString(R.string.perm_background_hint)
        b.done.isEnabled = fine && bg && phone
        b.summary.text = getString(R.string.perm_summary, DeviceInfo.locationPermission(this).replace('_', ' '), DeviceInfo.callPermission(this))
    }
}
