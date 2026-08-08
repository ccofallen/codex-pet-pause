package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Test

class PetOverlayStateRefreshBusTest {
    @Test
    fun runningOverlayReceivesCommittedStateRefreshInProcess() {
        var deliveries = 0
        val unsubscribe = PetOverlayStateRefreshBus.subscribe { deliveries += 1 }

        assertEquals(1, PetOverlayStateRefreshBus.publish())
        assertEquals(1, deliveries)
        unsubscribe()
        assertEquals(0, PetOverlayStateRefreshBus.publish())
    }
}
