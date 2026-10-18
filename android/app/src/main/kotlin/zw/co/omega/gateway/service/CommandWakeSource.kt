package zw.co.omega.gateway.service

/**
 * Extension point for a push wake-up (e.g. Firebase Cloud Messaging) that would tell the phone
 * "poll for commands now" instead of waiting for the next poll. Not wired to any provider: the
 * initial implementation relies on the command poll in the heartbeat loop. A future FCM service
 * would call [CommandWakeSource.onWake], which the GatewayService turns into an immediate poll.
 */
object CommandWakeSource {
    @Volatile private var listener: (() -> Unit)? = null
    fun attach(l: () -> Unit) { listener = l }
    fun detach() { listener = null }
    /** Called by a push transport when a command is waiting. Safe to call when nothing is attached. */
    fun onWake() { listener?.invoke() }
}
