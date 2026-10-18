package zw.co.omega.gateway

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import zw.co.omega.gateway.location.FixSummary
import zw.co.omega.gateway.location.LocationRequestPolicy
import zw.co.omega.gateway.location.LocationRequestPolicy.Outcome
import zw.co.omega.gateway.model.DeviceCommand

class LocationRequestPolicyTest {
    private val now = 1_760_000_000_000L
    private fun cmd(expiresIn: Long = 180_000L, maxAcc: Float = 100f, fresh: Boolean = true) = DeviceCommand("r1", DeviceCommand.REQUEST_LOCATION, now - 5_000, now + expiresIn, maxAcc, fresh)

    @Test fun `command parses from the server payload and ignores junk`() {
        val arr = JSONArray().put(JSONObject().put("id", "abc").put("type", "REQUEST_LOCATION").put("requestedAt", "2026-10-18T20:45:00.000Z").put("expiresAt", "2026-10-18T20:48:00.000Z").put("maxAccuracyM", 50).put("requireFreshFix", true))
            .put(JSONObject().put("type", "REQUEST_LOCATION")) // no id
            .put(JSONObject().put("id", "x").put("type", "REQUEST_LOCATION")) // no deadline
        val list = DeviceCommand.listFromJson(arr)
        assertEquals(1, list.size)
        assertEquals("abc", list[0].id); assertEquals(50f, list[0].maxAccuracyM); assertTrue(list[0].requireFreshFix)
        assertEquals(DeviceCommand.parseIso("2026-10-18T20:48:00.000Z"), list[0].expiresAtMs)
        assertTrue(list[0].isExpiredAt(list[0].expiresAtMs)); assertFalse(list[0].isExpiredAt(list[0].expiresAtMs - 1))
        assertTrue(DeviceCommand.listFromJson(null).isEmpty())
    }

    @Test fun `an expired command never starts the GPS`() {
        assertEquals(LocationRequestPolicy.Precheck.EXPIRED, LocationRequestPolicy.precheck(cmd(expiresIn = -1), now, true, true))
        assertEquals(LocationRequestPolicy.Precheck.PERMISSION_DENIED, LocationRequestPolicy.precheck(cmd(), now, false, true))
        assertEquals(LocationRequestPolicy.Precheck.LOCATION_DISABLED, LocationRequestPolicy.precheck(cmd(), now, true, false))
        assertEquals(LocationRequestPolicy.Precheck.OK, LocationRequestPolicy.precheck(cmd(), now, true, true))
    }

    @Test fun `a monitoring fix is reused only when fresh and precise enough`() {
        assertTrue(LocationRequestPolicy.canReuse(cmd(), now - 10_000, 15f, now))
        assertFalse("too old", LocationRequestPolicy.canReuse(cmd(), now - 60_000, 15f, now))
        assertFalse("too loose", LocationRequestPolicy.canReuse(cmd(maxAcc = 50f), now - 10_000, 80f, now))
        assertFalse("no fix yet", LocationRequestPolicy.canReuse(cmd(), 0L, 15f, now))
        assertFalse("future clock", LocationRequestPolicy.canReuse(cmd(), now + 5_000, 15f, now))
    }

    @Test fun `budget follows the deadline within limits`() {
        assertEquals(45_000L, LocationRequestPolicy.budgetMs(cmd(expiresIn = 180_000), now))
        assertEquals(20_000L, LocationRequestPolicy.budgetMs(cmd(expiresIn = 20_000), now))
        assertEquals(10_000L, LocationRequestPolicy.budgetMs(cmd(expiresIn = 2_000), now))
        val a = LocationRequestPolicy.acquisition(cmd(maxAcc = 60f), now)
        assertEquals(20f, a.goodEnoughM); assertEquals(60f, a.acceptableM)
    }

    @Test fun `a loose fix is POOR_ACCURACY with its coordinates, never a completed position`() {
        val c = cmd(maxAcc = 50f)
        val poor = LocationRequestPolicy.judge(c, FixSummary(120f, now, "network"), -17.8, 31.0, "network", mock = false, reused = false, backgroundRestricted = false)
        assertTrue(poor is Outcome.Failed); poor as Outcome.Failed
        assertEquals("POOR_ACCURACY", poor.reason); assertEquals(-17.8, poor.latitude!!, 1e-9); assertEquals(120f, poor.accuracyM)
        val ok = LocationRequestPolicy.judge(c, FixSummary(18f, now, "gps"), -17.8, 31.0, "gps", mock = true, reused = false, backgroundRestricted = false)
        assertTrue(ok is Outcome.Completed); ok as Outcome.Completed
        assertEquals(18f, ok.accuracyM); assertTrue("mock flag travels with the fix", ok.mock)
        val none = LocationRequestPolicy.judge(c, null, null, null, null, false, false, backgroundRestricted = false)
        assertEquals("GPS_TIMEOUT", (none as Outcome.Failed).reason)
        val restricted = LocationRequestPolicy.judge(c, null, null, null, null, false, false, backgroundRestricted = true)
        assertEquals("SERVICE_RESTRICTED", (restricted as Outcome.Failed).reason)
    }
}
