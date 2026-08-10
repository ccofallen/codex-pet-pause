package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidCapabilitiesChangedBusTest {
    @Test
    fun publishesMenuLifecycleChangesToTheOpenAppAndSupportsUnsubscribe() {
        var notifications = 0
        val unsubscribe = AndroidCapabilitiesChangedBus.subscribe { notifications += 1 }

        assertEquals(1, AndroidCapabilitiesChangedBus.publish())
        assertEquals(1, notifications)

        unsubscribe()
        assertEquals(0, AndroidCapabilitiesChangedBus.publish())
        assertEquals(1, notifications)
    }
}
