package io.elevenlabs.codexpetpause.bridge

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class AndroidOverlayRefreshRetrierTest {
    @Test
    fun commandFailureIsObservableAndRetriesUntilDeliverySucceeds() {
        var attempts = 0
        val scheduled = ArrayDeque<() -> Unit>()
        val retrier = AndroidOverlayRefreshRetrier(
            command = {
                attempts += 1
                if (attempts < 3) throw IOException("service temporarily unavailable")
            },
            schedule = { _, action -> scheduled.addLast(action) },
        )

        assertNotNull(retrier.refresh())
        while (scheduled.isNotEmpty()) scheduled.removeFirst().invoke()

        assertEquals(3, attempts)
    }

    @Test
    fun retryAttemptsRemainStrictlyBounded() {
        var attempts = 0
        val scheduled = ArrayDeque<() -> Unit>()
        val retrier = AndroidOverlayRefreshRetrier(
            command = { attempts += 1; throw IOException("still unavailable") },
            schedule = { _, action -> scheduled.addLast(action) },
        )

        retrier.refresh()
        while (scheduled.isNotEmpty()) scheduled.removeFirst().invoke()

        assertEquals(1 + AndroidOverlayRefreshRetrier.RETRY_DELAYS_MS.size, attempts)
    }
}
