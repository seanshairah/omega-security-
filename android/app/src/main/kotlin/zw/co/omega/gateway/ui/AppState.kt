package zw.co.omega.gateway.ui

/**
 * The one place that decides which screen the guard should see. Pure (no Android types) so it is
 * unit-tested; the activities only ask `resolveAppState(...)` and act on the answer.
 *
 * Replaces the pair of booleans (`isActivated`, `onboardingDone`) that used to be checked in two
 * places with opposite assumptions, which sent guard phones round the onboarding screen forever.
 */
enum class AppState {
    /** No token on the phone: show the activation screen. */
    NOT_ACTIVATED,
    /** Activated, but a permission the mode needs is missing and onboarding has not finished: show onboarding once. */
    PERMISSIONS_INCOMPLETE,
    /** Activated and every required permission granted: show the dashboard. */
    READY,
    /** Onboarding finished earlier, but a required permission was taken away since: dashboard with a warning, no automatic redirect. */
    PERMISSION_REVOKED,
    /** The server rejected the token (revoked/disabled): dashboard shows "ask the administrator". */
    REACTIVATION_REQUIRED,
}

data class AppFacts(
    val activated: Boolean,
    val guardMode: Boolean,
    val authRejected: Boolean,
    val onboardingDone: Boolean,
    /** "denied" | "foreground_only" | "background" (see DeviceInfo.locationPermission) */
    val locationPermission: String,
    /** "denied" | "partial" | "granted" (see DeviceInfo.callPermission) */
    val callPermission: String,
)

fun requiredPermissionsGranted(f: AppFacts): Boolean =
    if (f.guardMode) f.locationPermission == "background" && f.callPermission == "granted"
    else f.callPermission == "granted"

fun resolveAppState(f: AppFacts): AppState = when {
    !f.activated -> AppState.NOT_ACTIVATED
    f.authRejected -> AppState.REACTIVATION_REQUIRED
    requiredPermissionsGranted(f) -> AppState.READY
    f.onboardingDone -> AppState.PERMISSION_REVOKED
    else -> AppState.PERMISSIONS_INCOMPLETE
}
