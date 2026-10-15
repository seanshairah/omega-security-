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
}
