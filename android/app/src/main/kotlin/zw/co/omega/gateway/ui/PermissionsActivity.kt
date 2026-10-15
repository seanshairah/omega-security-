package zw.co.omega.gateway.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
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
        b.location.setOnClickListener { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
        b.background.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) launcher.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        }
        b.phone.setOnClickListener { launcher.launch(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)) }
        b.notifications.setOnClickListener { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) }
        b.battery.setOnClickListener { try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } }
        b.done.setOnClickListener { prefs.onboardingDone = true; GatewayService.start(this); startActivity(Intent(this, MainActivity::class.java)); finish() }
    }

    override fun onResume() { super.onResume(); render() }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun render() {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val phone = granted(Manifest.permission.READ_PHONE_STATE) && granted(Manifest.permission.READ_CALL_LOG)
        val notif = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(Manifest.permission.POST_NOTIFICATIONS)
        val batt = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        fun mark(v: android.widget.TextView, ok: Boolean) { v.text = if (ok) "✅" else "⬜" }
        mark(b.locationMark, fine); mark(b.backgroundMark, bg); mark(b.phoneMark, phone); mark(b.notificationsMark, notif); mark(b.batteryMark, batt)
        b.background.isEnabled = fine
        b.backgroundHint.text = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) getString(R.string.perm_background_hint_r) else getString(R.string.perm_background_hint)
        b.done.isEnabled = fine && bg && phone
        b.summary.text = getString(R.string.perm_summary, DeviceInfo.locationPermission(this).replace('_', ' '), DeviceInfo.callPermission(this))
    }
}
