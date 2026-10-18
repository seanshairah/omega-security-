package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import zw.co.omega.gateway.geofence.*

class GeofenceEngineTest {
    private val site = Site("s1", "Silverpeak Mine", -17.8292, 31.0522, 150)
    private fun at(dLat: Double, acc: Float = 10f) = classify(site.latitude + dLat, site.longitude, acc, site, 100)

    @Test
    fun `classification is accuracy aware`() {
        assertEquals(LocState.INSIDE, at(0.0003).state)
        assertEquals(LocState.OUTSIDE, at(0.0038).state)
        assertEquals(LocState.UNKNOWN, at(0.0013, 30f).state)
        assertEquals(LocState.UNKNOWN, at(0.0038, 200f).state)
        assertEquals("poor_accuracy", at(0.0038, 200f).reason)
    }

    @Test
    fun `section 50 scenario matches the server reducer`() {
        val T = { hhmm: String -> java.time.Instant.parse("2026-10-15T$hhmm:00Z").toEpochMilli() }
        val p = Policy()
        var s = MonitorState(Phase.MONITORING, T("18:03"))
        val out = mutableListOf<String>()
        fun run(t: String, st: LocState, d: Double?, plus: Int = 0): Step {
            val r = stepMonitor(s, Observation(T(t) + plus * 1000L, st, d), p); s = r.next
            r.events.forEach { out += "$t${if (plus > 0) "+${plus}s" else ""} ${it.type}${it.durationOutsideSeconds?.let { d -> " ${d / 60}min" } ?: ""}" }
            return r
        }
        run("18:03", LocState.INSIDE, 20.0); run("19:00", LocState.INSIDE, 25.0); run("20:00", LocState.INSIDE, 18.0)
        val first = run("22:15", LocState.OUTSIDE, 420.0)
        assertTrue(first.events.isEmpty()); assertEquals(60, first.nextCheckSeconds)
        assertEquals("LOCATION_EXIT", run("22:15", LocState.OUTSIDE, 435.0, 60).events.first().type)
        run("22:18", LocState.OUTSIDE, 440.0); run("22:25", LocState.OUTSIDE, 480.0); run("22:35", LocState.OUTSIDE, 510.0)
        val back = run("23:05", LocState.INSIDE, 38.0)
        assertEquals("LOCATION_RETURNED", back.events.first().type)
        assertEquals(50 * 60, back.events.first().durationOutsideSeconds)
        assertEquals(listOf("18:03 LOCATION_CHECK", "19:00 LOCATION_CHECK", "20:00 LOCATION_CHECK", "22:15+60s LOCATION_EXIT", "22:25 LOCATION_OUTSIDE", "22:35 LOCATION_OUTSIDE", "23:05 LOCATION_RETURNED 50min"), out)
    }

    @Test
    fun `unknown is reported once and never counts as outside`() {
        var s = MonitorState(Phase.MONITORING, 0)
        var r = stepMonitor(s, Observation(0, LocState.UNKNOWN, reason = "permission_revoked"), Policy()); s = r.next
        assertEquals("LOCATION_UNAVAILABLE", r.events.single().type)
        r = stepMonitor(s, Observation(300_000, LocState.UNKNOWN, reason = "permission_revoked"), Policy()); s = r.next
        assertTrue(r.events.isEmpty())
        assertEquals(Phase.LOCATION_UNAVAILABLE, s.phase)
    }

    @Test
    fun `a single outside reading never emits an exit - a second reading after the verify window does`() {
        val p = Policy(verifySeconds = 60)
        val t0 = 1_000_000L
        val first = stepMonitor(MonitorState(Phase.MONITORING, t0), Observation(t0, LocState.OUTSIDE, 400.0), p)
        assertTrue(first.events.isEmpty()); assertEquals(Phase.VERIFYING_OUTSIDE, first.next.phase)
        val tooSoon = stepMonitor(first.next, Observation(t0 + 20_000, LocState.OUTSIDE, 410.0), p)
        assertTrue("still verifying", tooSoon.events.isEmpty())
        val back = stepMonitor(first.next, Observation(t0 + 30_000, LocState.INSIDE, 30.0), p)
        assertEquals("a return during verification cancels the exit quietly", listOf("LOCATION_CHECK"), back.events.map { it.type })
        val confirmed = stepMonitor(first.next, Observation(t0 + 61_000, LocState.OUTSIDE, 420.0), p)
        assertEquals(listOf("LOCATION_EXIT"), confirmed.events.map { it.type })
    }

    @Test
    fun `unknown readings never change an outside or inside verdict`() {
        val p = Policy()
        val inside = MonitorState(Phase.MONITORING, 0)
        val u = stepMonitor(inside, Observation(1000, LocState.UNKNOWN, reason = "poor_accuracy"), p)
        assertEquals(Phase.LOCATION_UNAVAILABLE, u.next.phase)
        assertEquals("LOCATION_UNAVAILABLE", u.events.single().type)
        assertEquals("poor_accuracy", u.events.single().reason)
        val again = stepMonitor(u.next, Observation(2000, LocState.UNKNOWN, reason = "no_fix"), p)
        assertTrue("repeated unknown is not re-announced", again.events.isEmpty())
        val outside = MonitorState(Phase.OUTSIDE, 0, outsideSince = 0, lastOutsideUpdate = 0)
        val uo = stepMonitor(outside, Observation(5000, LocState.UNKNOWN, reason = "no_fix"), p)
        assertEquals("an unknown reading while outside stays outside", Phase.OUTSIDE, uo.next.phase)
    }

    @Test
    fun `low battery stretches only routine inside checks`() {
        assertEquals(1200, adjustForBattery(600, 15, Phase.MONITORING))
        assertEquals(600, adjustForBattery(600, 50, Phase.MONITORING))
        assertEquals(180, adjustForBattery(180, 15, Phase.OUTSIDE))
        assertEquals(60, adjustForBattery(60, 5, Phase.VERIFYING_OUTSIDE))
        assertEquals(30 * 60, adjustForBattery(20 * 60, 10, Phase.MONITORING))
        assertEquals("unknown battery level leaves the interval alone", 600, adjustForBattery(600, -1, Phase.MONITORING))
    }
}
