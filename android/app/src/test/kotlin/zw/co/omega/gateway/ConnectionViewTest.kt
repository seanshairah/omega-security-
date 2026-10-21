package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Test
import zw.co.omega.gateway.ui.ConnectionView
import zw.co.omega.gateway.ui.connectionView

/** Issue D from the v1.8 device test: the chip said "No internet" while the server had the phone's heartbeats. */
class ConnectionViewTest {
    private val now = 1_761_000_000_000L
    private val min = 60_000L

    @Test fun `recent heartbeat is online even when Android reports no network`() =
        assertEquals(ConnectionView.ONLINE, connectionView(false, isOnline = false, heartbeatOk = true, lastHeartbeatAt = now - min, heartbeatSeconds = 120, now = now))

    @Test fun `no network and no recent heartbeat is no internet`() =
        assertEquals(ConnectionView.NO_INTERNET, connectionView(false, isOnline = false, heartbeatOk = true, lastHeartbeatAt = now - 30 * min, heartbeatSeconds = 120, now = now))

    @Test fun `network up but no heartbeat for three intervals is not connected, not online`() =
        assertEquals(ConnectionView.NOT_HEARD, connectionView(false, isOnline = true, heartbeatOk = true, lastHeartbeatAt = now - 7 * min, heartbeatSeconds = 120, now = now))

    @Test fun `heartbeat just failed is reconnecting`() =
        assertEquals(ConnectionView.RECONNECTING, connectionView(false, isOnline = true, heartbeatOk = false, lastHeartbeatAt = now - min, heartbeatSeconds = 120, now = now))

    @Test fun `revoked wins over everything`() =
        assertEquals(ConnectionView.REVOKED, connectionView(true, isOnline = true, heartbeatOk = true, lastHeartbeatAt = now, heartbeatSeconds = 120, now = now))

    @Test fun `never heard from is reconnecting`() =
        assertEquals(ConnectionView.RECONNECTING, connectionView(false, isOnline = true, heartbeatOk = false, lastHeartbeatAt = 0, heartbeatSeconds = 120, now = now))
}
