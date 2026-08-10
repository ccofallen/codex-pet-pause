package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Test

class OverlayWebEventGateTest {
    @Test
    fun queuesUntilReadyThenSendsStateBeforeEvents() {
        val gate = OverlayWebEventGate<String>()
        val delivered = mutableListOf<String>()

        gate.send("open-menu", delivered::add)
        gate.send("drag-start", delivered::add)
        assertEquals(emptyList<String>(), delivered)

        gate.markReady({ delivered += "state" }, delivered::add)
        assertEquals(listOf("state", "open-menu", "drag-start"), delivered)

        gate.send("drag-end", delivered::add)
        assertEquals(listOf("state", "open-menu", "drag-start", "drag-end"), delivered)
    }

    @Test
    fun resetDropsEventsFromTheDestroyedWebView() {
        val gate = OverlayWebEventGate<String>()
        val delivered = mutableListOf<String>()
        gate.send("stale-menu", delivered::add)

        gate.reset()
        gate.markReady({ delivered += "new-state" }, delivered::add)

        assertEquals(listOf("new-state"), delivered)
    }

    @Test
    fun boundedQueueRetainsTheNewestEvents() {
        val gate = OverlayWebEventGate<String>(capacity = 2)
        val delivered = mutableListOf<String>()
        gate.send("one", delivered::add)
        gate.send("two", delivered::add)
        gate.send("three", delivered::add)

        gate.markReady({}, delivered::add)

        assertEquals(listOf("two", "three"), delivered)
    }
}
