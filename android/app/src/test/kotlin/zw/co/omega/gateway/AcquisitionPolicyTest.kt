package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Test
import zw.co.omega.gateway.location.*

class AcquisitionPolicyTest {
    private val p = AcquisitionPolicy(budgetMs = 60_000, goodEnoughM = 25f, acceptableM = 100f, settleMs = 15_000)
    private fun fix(acc: Float, t: Long = 0L) = FixSummary(acc, t, "gps")

    @Test fun `keeps listening while there is no fix and budget remains`() {
        assertEquals(Decision.CONTINUE, decide(p, null, 0))
        assertEquals(Decision.CONTINUE, decide(p, null, 59_999))
        assertEquals(Decision.STOP, decide(p, null, 60_000))
    }

    @Test fun `a good fix stops immediately`() { assertEquals(Decision.STOP, decide(p, fix(12f), 1_000)) }

    @Test fun `a usable but loose fix waits for the settle window then stops`() {
        assertEquals(Decision.CONTINUE, decide(p, fix(80f), 5_000))
        assertEquals(Decision.STOP, decide(p, fix(80f), 15_000))
    }

    @Test fun `a poor fix keeps listening until the budget - the limit is not relaxed`() {
        assertEquals(Decision.CONTINUE, decide(p, fix(121f), 30_000))
        assertEquals(Decision.STOP, decide(p, fix(121f), 60_000))
    }

    @Test fun `better prefers tighter accuracy then recency`() {
        assertEquals(50f, better(fix(120f), fix(50f)).accuracyM)
        assertEquals(50f, better(fix(50f), fix(120f)).accuracyM)
        assertEquals(2L, better(fix(50f, 1L), fix(50f, 2L)).timeMs)
        assertEquals(fix(30f, 1L), better(null, fix(30f, 1L)))
    }
}
