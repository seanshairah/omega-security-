package zw.co.omega.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import zw.co.omega.gateway.call.CallTracker
import zw.co.omega.gateway.model.GatewayEvent

class CallTrackerTest {
    private val events = mutableListOf<GatewayEvent>()
    private var now = 1_000_000L
    private var seq = 0
    private val tracker = CallTracker(sink = { events += it }, clock = { now }, newId = { "id-${++seq}" })

    @Test
    fun `incoming call answered then ended emits started answered ended with duration`() {
        tracker.onPhoneState("RINGING", null)          // Android 9+: first broadcast without number
        assertTrue("no start until number known", events.isEmpty())
        tracker.onPhoneState("RINGING", "+263771234567")
        assertEquals(GatewayEvent.CALL_STARTED, events.single().eventType)
        assertEquals("+263771234567", events.single().phoneNumber)
        now += 6_000
        tracker.onPhoneState("OFFHOOK", null)
        assertEquals(GatewayEvent.CALL_ANSWERED, events.last().eventType)
        now += 222_000
        val finished = tracker.onPhoneState("IDLE", null)
        assertNotNull(finished)
        tracker.complete(finished!!, null)
        val end = events.last()
        assertEquals(GatewayEvent.CALL_ENDED, end.eventType)
        assertEquals(222, end.durationSeconds)
        assertEquals(true, end.answered)
        assertEquals(3, events.size)
        assertTrue("one callId across all events", events.map { it.callId }.toSet().size == 1)
    }

    @Test
    fun `incoming call never answered is missed`() {
        tracker.onPhoneState("RINGING", "0771234567")
        now += 20_000
        val f = tracker.onPhoneState("IDLE", null)!!
        tracker.complete(f, null)
        assertEquals(GatewayEvent.CALL_MISSED, events.last().eventType)
        assertEquals(false, events.last().answered)
    }

    @Test
    fun `call log verdict overrides the state guess`() {
        tracker.onPhoneState("RINGING", "0771234567")
        tracker.onPhoneState("OFFHOOK", null)
        val f = tracker.onPhoneState("IDLE", null)!!
        tracker.complete(f, CallTracker.LogInfo(answered = false, durationSeconds = 0, number = "0771234567"))
        assertEquals("declined calls read from the log end as MISSED", GatewayEvent.CALL_MISSED, events.last().eventType)
    }

    @Test
    fun `outgoing call uses dialled number and ends as ENDED`() {
        tracker.onOutgoingNumber("0772000000")
        tracker.onPhoneState("OFFHOOK", null)
        assertEquals("OUTGOING", events.single().direction)
        assertEquals("0772000000", events.single().phoneNumber)
        now += 30_000
        val f = tracker.onPhoneState("IDLE", null)!!
        tracker.complete(f, CallTracker.LogInfo(answered = true, durationSeconds = 25, number = "0772000000"))
        assertEquals(GatewayEvent.CALL_ENDED, events.last().eventType)
        assertEquals(25, events.last().durationSeconds)
    }

    @Test
    fun `duplicate broadcasts do not create extra events`() {
        tracker.onPhoneState("RINGING", "0771234567")
        tracker.onPhoneState("RINGING", "0771234567")
        tracker.onPhoneState("OFFHOOK", null)
        tracker.onPhoneState("OFFHOOK", null)
        assertEquals(2, events.size)
        assertNull("IDLE when already idle returns nothing", tracker.onPhoneState("IDLE", null).also { tracker.onPhoneState("IDLE", null) }?.let { null })
    }

    @Test
    fun `event json carries ISO timestamp and storage round-trips`() {
        val e = GatewayEvent(eventId = "e1", eventType = GatewayEvent.CALL_ENDED, callId = "c1", phoneNumber = "+263771234567", direction = "INCOMING", timestampMs = 1_760_000_000_000L, durationSeconds = 12, answered = true)
        val json = e.toJson()
        assertEquals("2025-10-09T08:53:20.000Z", json.getString("timestamp"))
        val back = GatewayEvent.fromJson(org.json.JSONObject(GatewayEvent.toStorageJson(e)))
        assertEquals(e, back)
    }
}
