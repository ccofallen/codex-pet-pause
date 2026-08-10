package io.elevenlabs.codexpetpause.bridge

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidCommittedStateBusTest {
    @Test
    fun publishFansOutCommittedRevisionAndUnsubscribeStopsDelivery() {
        val first = mutableListOf<Long>()
        val second = mutableListOf<Long>()
        val unsubscribeFirst = AndroidCommittedStateBus.subscribe(first::add)
        val unsubscribeSecond = AndroidCommittedStateBus.subscribe(second::add)

        try {
            AndroidCommittedStateBus.publish(7L)
            unsubscribeFirst()
            AndroidCommittedStateBus.publish(8L)

            assertEquals(listOf(7L), first)
            assertEquals(listOf(7L, 8L), second)
        } finally {
            unsubscribeFirst()
            unsubscribeSecond()
        }
    }
}
