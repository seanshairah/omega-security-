package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import zw.co.omega.gateway.ui.*

class StatusModelTest {
    private fun facts(shift: ShiftView = ShiftView.ACTIVE, checking: Boolean = false, phase: String = "MONITORING", reason: String? = null, online: Boolean = true, rejected: Boolean = false, queued: Int = 0, lastSync: Long = 1L, hbOk: Boolean = true, lastCheck: Long = 1L) =
        StatusFacts(shift, checking, phase, reason, lastCheck, online, rejected, queued, lastSync, hbOk)

    @Test fun `poor accuracy is never reported as location switched off`() {
        assertEquals(GpsReasonKind.POOR_ACCURACY, gpsReasonKind("poor_accuracy", 1L))
        assertNotEquals(GpsReasonKind.LOCATION_OFF, gpsReasonKind("poor_accuracy", 1L))
        assertEquals(GpsReasonKind.LOCATION_OFF, gpsReasonKind("location_disabled", 1L))
        assertEquals(GpsReasonKind.PERMISSION, gpsReasonKind("permission_revoked", 1L))
        assertEquals(GpsReasonKind.SITE_NO_COORDINATES, gpsReasonKind("site_has_no_coordinates", 1L))
        assertEquals(GpsReasonKind.ON_BOUNDARY, gpsReasonKind("on_boundary", 1L))
        assertEquals(GpsReasonKind.NOT_CHECKED_YET, gpsReasonKind(null, 0L))
    }

    @Test fun `gps state is independent of connectivity`() {
        // Offline phone, guard inside: GPS says INSIDE, sync says NO_INTERNET. Never "outside".
        val f = facts(online = false, queued = 3)
        assertEquals(GpsView.INSIDE, gpsView(f))
        assertEquals(SyncView.NO_INTERNET, syncView(f))
    }

    @Test fun `unknown is not outside`() {
        assertEquals(GpsView.UNKNOWN, gpsView(facts(phase = "LOCATION_UNAVAILABLE", reason = "poor_accuracy")))
        assertEquals(GpsView.OUTSIDE, gpsView(facts(phase = "OUTSIDE")))
        assertEquals(GpsView.OUTSIDE_VERIFYING, gpsView(facts(phase = "VERIFYING_OUTSIDE")))
    }

    @Test fun `no shift means gps is off regardless of the last phase`() {
        assertEquals(GpsView.OFF, gpsView(facts(shift = ShiftView.NONE, phase = "OUTSIDE")))
        assertEquals(GpsView.OFF, gpsView(facts(shift = ShiftView.UPCOMING)))
    }

    @Test fun `a running acquisition shows as checking`() { assertEquals(GpsView.CHECKING, gpsView(facts(checking = true, phase = "LOCATION_UNAVAILABLE"))) }

    @Test fun `sync view ordering`() {
        assertEquals(SyncView.REVOKED, syncView(facts(rejected = true, online = false)))
        assertEquals(SyncView.QUEUED, syncView(facts(queued = 2)))
        assertEquals(SyncView.SENDING, syncView(facts(queued = 2).copy(syncState = "SENDING")))
        assertEquals(SyncView.RETRY_PENDING, syncView(facts(queued = 2).copy(syncState = "RETRY_PENDING")))
        assertEquals(SyncView.SYNCED_WITH_FAILURES, syncView(facts().copy(syncState = "SYNCED_WITH_FAILURES")))
        assertEquals(SyncView.SYNCED, syncView(facts()))
        assertEquals("offline with nothing to send is not an error", SyncView.NO_INTERNET, syncView(facts(online = false, lastSync = 0L, hbOk = false)))
        assertEquals(SyncView.WAITING, syncView(facts(lastSync = 0L, hbOk = false)))
    }

    @Test fun `accuracy keeps one decimal so 100_4 m is not shown as 100 m`() {
        assertEquals("±100.4 m", formatAccuracy(100.4f))
        assertEquals("±14.0 m", formatAccuracy(14f))
        assertEquals("—", formatDistance(-1f))
        assertEquals("14 m", formatDistance(14.2f))
    }
}
