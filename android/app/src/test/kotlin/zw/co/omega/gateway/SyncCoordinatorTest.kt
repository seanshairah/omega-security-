package zw.co.omega.gateway

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import zw.co.omega.gateway.service.SyncCoordinator
import zw.co.omega.gateway.service.Trigger
import java.util.Collections

class SyncCoordinatorTest {
    private fun scope() = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Test fun `runs once at start then on triggers, coalescing requests made mid-run`() = runBlocking {
        val s = scope()
        val triggers = Collections.synchronizedList(mutableListOf<Trigger>())
        val c = SyncCoordinator(s, runner = { t -> triggers += t; delay(200); null }, periodMs = 60_000)
        c.start()
        delay(50)
        assertTrue(c.syncing.value)
        assertFalse(c.request(Trigger.NEW_EVENT))
        assertFalse(c.request(Trigger.MANUAL))
        delay(500)
        assertEquals(listOf(Trigger.APP_START, Trigger.MANUAL), triggers.toList())
        assertTrue("manual is remembered as the stronger of the two queued triggers", triggers.last() == Trigger.MANUAL)
        s.cancel()
    }

    @Test fun `wakes for the earliest retry time instead of waiting the whole period`() = runBlocking {
        val s = scope()
        val triggers = Collections.synchronizedList(mutableListOf<Trigger>())
        var retryAt: Long? = null
        val c = SyncCoordinator(s, runner = { t -> triggers += t; if (t == Trigger.APP_START) retryAt = System.currentTimeMillis() + 150; null }, nextRetryAtMs = { retryAt }, periodMs = 60_000, minWaitMs = 10)
        c.start()
        delay(600)
        assertTrue("expected a RETRY run, got $triggers", triggers.contains(Trigger.RETRY))
        s.cancel()
    }

    @Test fun `a failing run is logged and the loop survives`() = runBlocking {
        val s = scope()
        val logs = Collections.synchronizedList(mutableListOf<String>())
        var n = 0
        val c = SyncCoordinator(s, runner = { if (++n == 1) throw IllegalStateException("boom") else null }, periodMs = 100, log = { logs += it })
        c.start()
        delay(400)
        assertTrue(c.runs >= 2)
        assertTrue(logs.any { it.contains("boom") })
        s.cancel()
    }
}
