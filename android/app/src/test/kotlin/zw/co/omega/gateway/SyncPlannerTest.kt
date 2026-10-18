package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import zw.co.omega.gateway.service.*

class SyncPlannerTest {
    @Test fun `backoff grows by three and is capped`() {
        assertEquals(5_000L, SyncPlanner.backoffMs(1))
        assertEquals(15_000L, SyncPlanner.backoffMs(2))
        assertEquals(45_000L, SyncPlanner.backoffMs(3))
        assertEquals(15 * 60_000L, SyncPlanner.backoffMs(20))
        assertEquals("emergency rows never wait more than a minute", 60_000L, SyncPlanner.backoffMs(20, Priority.EMERGENCY))
    }

    @Test fun `acks mean what the server says`() {
        assertEquals(AckOutcome.ACKED, SyncPlanner.ackOutcome("ok"))
        assertEquals(AckOutcome.ACKED, SyncPlanner.ackOutcome("duplicate"))
        assertEquals(AckOutcome.FAILED_PERMANENT, SyncPlanner.ackOutcome("rejected"))
        assertEquals(AckOutcome.UNKNOWN, SyncPlanner.ackOutcome(null))
        assertEquals(AckOutcome.UNKNOWN, SyncPlanner.ackOutcome("weird"))
    }

    @Test fun `priorities put exits, returns and calls before routine checks`() {
        assertEquals(Priority.HIGH, Priority.forEventType("LOCATION_EXIT"))
        assertEquals(Priority.HIGH, Priority.forEventType("CALL_STARTED"))
        assertEquals(Priority.NORMAL, Priority.forEventType("LOCATION_CHECK"))
        assertEquals(Priority.EMERGENCY, Priority.forEventType("EMERGENCY"))
    }

    @Test fun `due rules`() {
        val now = 1_000_000L
        assertTrue(SyncPlanner.isDue(OutboxStatus.QUEUED, 0, now, null))
        assertFalse(SyncPlanner.isDue(OutboxStatus.RETRY_PENDING, now + 1, now, null))
        assertTrue(SyncPlanner.isDue(OutboxStatus.RETRY_PENDING, now, now, null))
        assertFalse(SyncPlanner.isDue(OutboxStatus.FAILED, 0, now, null))
        assertFalse("a row being sent right now is not re-sent", SyncPlanner.isDue(OutboxStatus.SENDING, 0, now, now - 1000))
        assertTrue("a row stuck in SENDING from a dead run is retried", SyncPlanner.isDue(OutboxStatus.SENDING, 0, now, now - 10 * 60_000L))
    }

    @Test fun `sync state wording distinguishes offline from failures`() {
        assertEquals("REVOKED", SyncPlanner.syncState(true, true, 0, 0, 0, false))
        assertEquals("SENDING", SyncPlanner.syncState(true, false, 3, 0, 0, true))
        assertEquals("QUEUED_OFFLINE", SyncPlanner.syncState(false, false, 3, 0, 0, false))
        assertEquals("RETRY_PENDING", SyncPlanner.syncState(true, false, 0, 2, 0, false))
        assertEquals("SYNCED_WITH_FAILURES", SyncPlanner.syncState(true, false, 0, 0, 1, false))
        assertEquals("SYNCED", SyncPlanner.syncState(true, false, 0, 0, 0, false))
        assertEquals("an empty queue while offline is still synced, not an error", "SYNCED", SyncPlanner.syncState(false, false, 0, 0, 0, false))
    }
}
