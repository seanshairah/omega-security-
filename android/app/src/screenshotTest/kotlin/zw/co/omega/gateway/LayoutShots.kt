package zw.co.omega.gateway

import android.view.View
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import org.junit.Rule
import org.junit.Test
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.databinding.ActivityMainBinding
import zw.co.omega.gateway.ui.AppState
import zw.co.omega.gateway.ui.HomeFacts
import zw.co.omega.gateway.ui.HomeScreen
import zw.co.omega.gateway.ui.HomeShift

/**
 * The home screen drawn from made-up facts, on the JVM (layoutlib). For reviewing the layout at
 * different widths and text sizes without a phone. It is not a device test: no GPS, no service,
 * no real insets.
 *
 *   ./gradlew -Pscreenshots :app:recordPaparazziDebug
 */
abstract class HomeShots(device: DeviceConfig) {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = device, theme = "Theme.Gateway")

    private val now = 1_761_000_000_000L // a fixed instant so the shots do not change from run to run
    private val min = 60_000L

    protected fun shift(active: Boolean = true) = HomeShift(
        startAtMs = if (active) now - 25 * min else now + 8 * 60 * min, endAtMs = if (active) now + 695 * min else now + 20 * 60 * min,
        active = active, upcoming = !active, siteName = "Borrowdale Retail · Gate 2", siteHasCoordinates = true, radiusM = 150,
        shiftFence = false, testCoordinates = false, configVersion = "14", checkMinutes = 10, outsideCheckMinutes = 3, accuracyMaxM = 100,
    )

    private fun comm(type: String, status: String, ago: Long, kind: String = "ALERT", summary: String? = null) =
        EventQueue.CommRow("e$type$ago", kind, type, summary, now - ago * min, status, true, now - ago * min + 5_000, if (status == "ACKNOWLEDGED") "Control room" else null, if (status == "ACKNOWLEDGED") now - (ago - 2) * min else null, null, null)

    protected fun facts(guard: Boolean = true) = HomeFacts(
        guardMode = guard, appState = AppState.READY, guardName = "Tendai Mapfumo", deviceName = if (guard) "Gate 2 guard phone" else "Control room 1",
        network = "mobile", isOnline = true, heartbeatOk = true, authRejected = false, lastError = null, locationPermission = "background",
        canMonitorCalls = true, canSeeNumbers = true, batteryRestricted = false, queued = 0, rejected = 0, lastSyncAt = now - 2 * min, lastHeartbeatAt = now - min,
        syncState = "SYNCED", lastSyncError = null, shift = if (guard) shift() else null, gpsChecking = false, gpsState = "MONITORING", gpsReason = null,
        lastCheckAt = now - 4 * min, lastFixAt = now - 4 * min, lastAttemptAt = now - 4 * min, lastFixAccuracy = 5.2f, lastFixDistanceM = 12f, batterySaver = false,
        unacknowledged = 0,
        recent = listOf(comm("SHIFT_OK", "ACKNOWLEDGED", 40), comm("LOCATION_REQUEST_RESULT", "SENT", 70, kind = "operations")),
        lastCallSummary = if (guard) null else "Outgoing to Tendai Mapfumo · 1 min 12 s", lastCallAt = now - 9 * min,
        calls = if (guard) emptyList() else listOf(comm("CALL", "SENT", 9, kind = "CALL", summary = "Outgoing · Tendai Mapfumo · answered"), comm("CALL", "QUEUED", 31, kind = "CALL", summary = "Incoming · +263 77 884 0101 · missed")),
        now = now,
    )

    protected fun shot(name: String, f: HomeFacts) {
        val b = ActivityMainBinding.inflate(paparazzi.layoutInflater)
        HomeScreen.bind(paparazzi.context, b, f)
        paparazzi.snapshot(b.root as View, name)
    }
}

/** A mid-range phone, 393 dp wide. */
class HomePixel5 : HomeShots(DeviceConfig.PIXEL_5) {
    @Test fun onShiftInside() = shot("guard-on-shift-inside", facts())
    @Test fun outsideConfirmed() = shot("guard-outside", facts().copy(gpsState = "OUTSIDE", lastFixDistanceM = 412f, lastFixAccuracy = 8.4f, unacknowledged = 1))
    @Test fun nextShift() = shot("guard-next-shift", facts().copy(shift = shift(active = false), gpsState = "WAITING_FOR_SHIFT", lastFixAt = 0, lastCheckAt = 0, lastAttemptAt = 0))
    @Test fun operations() = shot("ops-gateway", facts(guard = false))
    @Test fun permissionNeeded() = shot("guard-permission-needed", facts().copy(appState = AppState.PERMISSIONS_INCOMPLETE, locationPermission = "foreground_only", gpsState = "LOCATION_UNAVAILABLE", gpsReason = "permission_revoked"))
}

/** The smallest phone the app is built for: 320 dp, the width of a 5-inch Android Go handset. */
class HomeSmall : HomeShots(DeviceConfig.NEXUS_5.copy(screenWidth = 960)) {
    @Test fun offlineQueued() = shot("small-offline-queued", facts().copy(isOnline = false, network = "none", heartbeatOk = false, queued = 4, syncState = "RETRY_PENDING", gpsReason = "poor_accuracy", gpsState = "LOCATION_UNAVAILABLE", lastFixAccuracy = 121.4f))
    @Test fun onShift() = shot("small-on-shift", facts())
}

/** Large text, as many older guards set it. */
class HomeLargeText : HomeShots(DeviceConfig.PIXEL_5.copy(fontScale = 1.3f)) {
    @Test fun onShift() = shot("large-text-on-shift", facts())
}

/** The whole guard screen at 320 dp, top to bottom, on an unrealistically tall screen. */
class HomeSmallFull : HomeShots(DeviceConfig.NEXUS_5.copy(screenWidth = 960, screenHeight = 5600)) {
    @Test fun onShift() = shot("small-full-on-shift", facts().copy(unacknowledged = 1))
}

/** The other screens as laid out, before any data is bound: a check that the theme holds. */
class OtherScreens {
    @get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5, theme = "Theme.Gateway")
    private fun layout(id: Int, name: String) = paparazzi.snapshot(paparazzi.inflate<View>(id), name)
    @Test fun alerts() = layout(R.layout.activity_alerts, "alerts")
    @Test fun permissions() = layout(R.layout.activity_permissions, "permissions")
    @Test fun activation() = layout(R.layout.activity_activation, "activation")
    @Test fun callConfirm() = layout(R.layout.activity_call_confirm, "call-confirm")
    @Test fun diagnostics() = layout(R.layout.activity_settings, "diagnostics")
}
