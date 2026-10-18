package zw.co.omega.gateway

import org.junit.Assert.*
import org.junit.Test
import zw.co.omega.gateway.ui.*

class DashboardToneTest {
    @Test fun `unknown and verifying are amber, never red`() {
        assertEquals(Tone.WARN, gpsTone(GpsView.UNKNOWN))
        assertEquals(Tone.WARN, gpsTone(GpsView.OUTSIDE_VERIFYING))
        assertEquals(Tone.CRITICAL, gpsTone(GpsView.OUTSIDE))
        assertEquals(Tone.OK, gpsTone(GpsView.INSIDE))
        assertEquals(Tone.NEUTRAL, gpsTone(GpsView.OFF))
        assertEquals(Tone.INFO, gpsTone(GpsView.CHECKING))
    }

    @Test fun `status word matches the verdict`() {
        assertEquals("Verified", gpsStatusWord(GpsView.INSIDE))
        assertEquals("Not verified", gpsStatusWord(GpsView.UNKNOWN))
        assertEquals("Not verified", gpsStatusWord(GpsView.OUTSIDE_VERIFYING))
        assertEquals("Outside", gpsStatusWord(GpsView.OUTSIDE))
        assertEquals("Off", gpsStatusWord(GpsView.OFF))
    }

    @Test fun `sync only up to date is green and only revoked is red`() {
        assertEquals(Tone.OK, syncTone(SyncView.SYNCED))
        assertEquals(Tone.CRITICAL, syncTone(SyncView.REVOKED))
        for (v in listOf(SyncView.QUEUED, SyncView.NO_INTERNET, SyncView.RETRY_PENDING, SyncView.SYNCED_WITH_FAILURES, SyncView.WAITING)) assertEquals(v.name, Tone.WARN, syncTone(v))
        assertEquals(Tone.INFO, syncTone(SyncView.SENDING))
    }
}
