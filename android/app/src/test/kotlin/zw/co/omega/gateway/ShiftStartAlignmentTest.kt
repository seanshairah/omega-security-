package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Test
import zw.co.omega.gateway.location.LocationMonitor

/** The check before a shift lands on the start time, so "on time" is decided by a fix taken then. */
class ShiftStartAlignmentTest {
    private val start = 1_000_000_000L

    @Test fun `ten minutes before, the next check is at the start, not ten minutes after the first`() {
        // First check at start - 9.5 min; the normal interval of 10 min would land 30 s after the start.
        assertEquals(570, LocationMonitor.alignToShiftStart(600, start - 570_000L, start))
    }

    @Test fun `an interval that already ends before the start is left alone`() {
        assertEquals(300, LocationMonitor.alignToShiftStart(300, start - 600_000L, start))
    }

    @Test fun `after the start, the normal interval applies`() {
        assertEquals(600, LocationMonitor.alignToShiftStart(600, start + 1_000L, start))
    }

    @Test fun `never sooner than thirty seconds, so a check just before the start does not spin`() {
        assertEquals(30, LocationMonitor.alignToShiftStart(600, start - 5_000L, start))
    }
}
