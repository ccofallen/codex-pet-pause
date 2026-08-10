package io.elevenlabs.codexpetpause.bridge

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import io.elevenlabs.codexpetpause.overlay.PetOverlayStateRefreshBus
import org.junit.Test

class AndroidCommittedMutationEffectsTest {
    @Test
    fun liveOverlayListenerReceivesOneRefreshWithoutServiceFallback() {
        var deliveries = 0
        var fallbackCalls = 0
        val unsubscribe = PetOverlayStateRefreshBus.subscribe { deliveries += 1 }

        try {
            val warning = deliverOverlayRefresh(
                publish = PetOverlayStateRefreshBus::publish,
                fallback = {
                    fallbackCalls += 1
                    IOException("service fallback should not run")
                },
            )

            assertNull(warning)
            assertEquals(1, deliveries)
            assertEquals(0, fallbackCalls)
        } finally {
            unsubscribe()
        }
    }

    @Test
    fun noLiveOverlayListenerUsesServiceFallbackAndPreservesItsWarning() {
        var fallbackCalls = 0
        val expectedWarning = IOException("foreground start refused")

        val warning = deliverOverlayRefresh(
            publish = PetOverlayStateRefreshBus::publish,
            fallback = {
                fallbackCalls += 1
                expectedWarning
            },
        )

        assertEquals(1, fallbackCalls)
        assertSame(expectedWarning, warning)
    }

    @Test
    fun publishFailureUsesRetrierFallbackAndPreservesItsWarning() {
        var fallbackCommands = 0
        var scheduledRetries = 0
        val expectedWarning = IOException("foreground start refused")
        val retrier = AndroidOverlayRefreshRetrier(
            command = {
                fallbackCommands += 1
                throw expectedWarning
            },
            schedule = { _, _ -> scheduledRetries += 1 },
        )

        val warning = runCatching {
            deliverOverlayRefresh(
                publish = { throw IOException("refresh bus listener failed") },
                fallback = retrier::refresh,
            )
        }.getOrNull()

        assertSame(expectedWarning, warning)
        assertEquals(1, fallbackCommands)
        assertEquals(1, scheduledRetries)
    }

    @Test
    fun ordinaryBridgeResponsesDoNotSerializeTheCommittedSnapshot() {
        val result = AndroidCommittedMutationEffects.run(
            mutation = { "large-snapshot-with-pet-atlases" },
            emitSnapshot = {},
            refreshOverlay = null,
        )

        assertNull(result.bridgeSnapshot(includeSnapshot = false))
        assertEquals(
            "large-snapshot-with-pet-atlases",
            result.bridgeSnapshot(includeSnapshot = true),
        )
    }

    @Test
    fun refreshFailureCannotTurnACommittedActivationIntoASaveFailure() {
        var committed = false
        val emitted = mutableListOf<String>()

        val result = AndroidCommittedMutationEffects.run(
            mutation = { committed = true; "committed-snapshot" },
            emitSnapshot = emitted::add,
            refreshOverlay = { throw IOException("foreground start refused") },
        )

        assertTrue(committed)
        assertEquals(listOf("committed-snapshot"), emitted)
        assertEquals("committed-snapshot", result.snapshot)
        assertNotNull(result.refreshWarning)
    }

    @Test
    fun eventFailureStillReturnsTheCommittedSnapshotToTheBridge() {
        val result = AndroidCommittedMutationEffects.run(
            mutation = { "committed-snapshot" },
            emitSnapshot = { throw IOException("listener unavailable") },
            refreshOverlay = null,
        )

        assertEquals("committed-snapshot", result.snapshot)
        assertNotNull(result.eventWarning)
    }
}
