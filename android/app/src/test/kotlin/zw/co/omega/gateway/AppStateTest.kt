package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Test
import zw.co.omega.gateway.ui.AppFacts
import zw.co.omega.gateway.ui.AppState
import zw.co.omega.gateway.ui.resolveAppState

class AppStateTest {
    private fun guard(onboardingDone: Boolean, loc: String, call: String = "granted", rejected: Boolean = false, activated: Boolean = true) =
        resolveAppState(AppFacts(activated, true, rejected, onboardingDone, loc, call))

    @Test fun `not activated wins over everything`() { assertEquals(AppState.NOT_ACTIVATED, guard(true, "background", activated = false)) }

    @Test fun `fresh guard phone goes to onboarding exactly while permissions are missing`() {
        assertEquals(AppState.PERMISSIONS_INCOMPLETE, guard(false, "denied"))
        assertEquals(AppState.PERMISSIONS_INCOMPLETE, guard(false, "foreground_only"))
        assertEquals(AppState.PERMISSIONS_INCOMPLETE, guard(false, "background", call = "partial"))
    }

    @Test fun `all permissions granted is READY whether or not onboarding was marked done`() {
        // This is the loop fix: granting everything on the onboarding screen must land on the dashboard.
        assertEquals(AppState.READY, guard(false, "background"))
        assertEquals(AppState.READY, guard(true, "background"))
    }

    @Test fun `permission taken away after onboarding is a warning, not another onboarding loop`() {
        assertEquals(AppState.PERMISSION_REVOKED, guard(true, "foreground_only"))
        assertEquals(AppState.PERMISSION_REVOKED, guard(true, "background", call = "denied"))
    }

    @Test fun `server rejection asks for reactivation`() { assertEquals(AppState.REACTIVATION_REQUIRED, guard(true, "background", rejected = true)) }

    @Test fun `operations gateway only needs call permissions`() {
        assertEquals(AppState.READY, resolveAppState(AppFacts(true, false, false, false, "denied", "granted")))
        assertEquals(AppState.PERMISSIONS_INCOMPLETE, resolveAppState(AppFacts(true, false, false, false, "denied", "partial")))
    }
}
