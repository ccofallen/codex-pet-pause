package io.elevenlabs.codexpetpause.bridge

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCommittedMutationEffectsTest {
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
