package zw.co.omega.gateway

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import zw.co.omega.gateway.service.MonitoringCoordinator
import zw.co.omega.gateway.service.MonitoringCoordinator.StepOutcome
import java.util.concurrent.atomic.AtomicInteger

class MonitoringCoordinatorTest {
    private fun scope() = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Test fun `a manual check during a running check joins it and runs once more afterwards`() = runBlocking {
        val s = scope()
        val steps = AtomicInteger(); val cancelled = AtomicInteger()
        val c = MonitoringCoordinator(s, stepper = {
            steps.incrementAndGet()
            try { delay(300) } catch (e: kotlinx.coroutines.CancellationException) { cancelled.incrementAndGet(); throw e }
            StepOutcome(nextCheckSeconds = 600)
        }, isGuardMode = { true }, minWaitMs = 10_000, maxWaitMs = 10_000)
        c.start()
        delay(100)
        assertTrue(c.checking.value)
        assertFalse("request while checking must not start a new check", c.requestCheck())
        delay(700)
        assertEquals("step ran, then once more for the queued tap", 2, steps.get())
        assertEquals("the running acquisition was never cancelled", 0, cancelled.get())
        s.cancel()
    }

    @Test fun `a config change wakes a long sleep`() = runBlocking {
        val s = scope()
        val steps = AtomicInteger()
        val changes = MutableStateFlow(0L)
        val c = MonitoringCoordinator(s, stepper = { steps.incrementAndGet(); StepOutcome(nextCheckSeconds = 0) }, isGuardMode = { true }, configChanges = changes, minWaitMs = 60_000, maxWaitMs = 60_000, noConfigWaitMs = 60_000)
        c.start()
        delay(150)
        assertEquals(1, steps.get())
        changes.value = 1L
        delay(300)
        assertEquals("woke on config change instead of sleeping 60 s", 2, steps.get())
        s.cancel()
    }

    @Test fun `a failing step is logged and the loop survives`() = runBlocking {
        val s = scope()
        val steps = AtomicInteger(); val logs = mutableListOf<String>()
        val c = MonitoringCoordinator(s, stepper = { if (steps.incrementAndGet() == 1) throw IllegalStateException("boom") else StepOutcome(5) }, isGuardMode = { true }, log = { logs += it }, minWaitMs = 50, maxWaitMs = 50)
        c.start()
        delay(400)
        assertTrue(steps.get() >= 2)
        assertTrue(logs.any { it.contains("boom") })
        s.cancel()
    }

    @Test fun `stop cancels the loop without a logged failure`() = runBlocking {
        val s = scope()
        val logs = mutableListOf<String>()
        val c = MonitoringCoordinator(s, stepper = { delay(10_000); StepOutcome(600) }, isGuardMode = { true }, log = { logs += it })
        c.start(); delay(100); c.stop(); delay(100)
        assertFalse(c.checking.value)
        assertTrue("cancellation is not a failure", logs.isEmpty())
        s.cancel()
    }

    @Test fun `start is idempotent`() = runBlocking {
        val s = scope()
        val steps = AtomicInteger()
        val c = MonitoringCoordinator(s, stepper = { steps.incrementAndGet(); StepOutcome(600) }, isGuardMode = { true }, minWaitMs = 60_000, maxWaitMs = 60_000)
        c.start(); c.start(); c.start()
        delay(200)
        assertEquals(1, steps.get())
        s.cancel()
    }
}
